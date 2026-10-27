"""A run never stays 'running': disconnects at any event, a crashed or stalled process, late writers and poisoned threads."""
import asyncio
import contextlib
import gc
import json
import logging
from datetime import timedelta

import httpx
import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from tests.fakes import IDENTITY, ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_contracts import READ_TOOL
from tests.test_service import BODY, HEADERS, LEAKY, RESUME_C1, SETTINGS, fresh, parse_sse
from webvue_ai_service.contracts import RunRequest
from webvue_ai_service.graph import build_graph, request_state, run_config
from webvue_ai_service.service import STALE_AFTER_SECONDS, create_app
from webvue_ai_service.store import MemoryRunStore

TASKS = "pmo__list_my_tasks"


def make_app(model, store=None, checkpointer=None):
    return create_app(model, store or MemoryRunStore(), checkpointer or InMemorySaver(), SETTINGS)


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def disconnect_at(app, event, body=None, *, wait=True):
    """POST straight through ASGI; the client vanishes while ``send`` writes ``event`` (the task is cancelled there)."""
    payload, reached, delivered = json.dumps(body or fresh()).encode(), asyncio.Event(), False

    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": payload, "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        if message["type"] == "http.response.body" and f"event: {event}".encode() in message.get("body", b""):
            reached.set()
            await asyncio.Event().wait()

    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": "/v1/runs", "raw_path": b"/v1/runs", "root_path": "", "query_string": b"", "server": ("ai", 80), "client": ("c", 1),
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()),
                    (b"x-webvue-tenant", b"t1"), (b"x-webvue-user", b"42")],
    }
    call = asyncio.create_task(app(scope, receive, send))
    await asyncio.wait_for(reached.wait(), 5)
    call.cancel()
    if wait:
        with contextlib.suppress(asyncio.CancelledError):
            await call
    return call


async def settled(store, run_id):
    for _ in range(100):
        if store.records[run_id].status != "running":
            break
        await asyncio.sleep(0.02)
    return store.records[run_id].status


@pytest.mark.parametrize(("event", "responses", "expected"), [
    ("run", [ai_text("x")], "failed"),
    ("answer", [ai_text("تم")], "done"),
    ("tool_request", [ai_tool_call(TASKS, {}, "c_1"), ai_text("x")], "waiting_tool"),
])
async def test_a_client_vanishing_while_an_event_is_sent_never_leaves_the_run_running(event, responses, expected):
    store = MemoryRunStore()
    app = make_app(ScriptedChatModel(responses), store)
    gc.collect()
    gc.disable()  # the run must be closed by the response, not by the garbage collector
    try:
        await disconnect_at(app, event)
        [record] = store.records.values()
        assert await settled(store, record.run_id) == expected
    finally:
        gc.enable()
    if expected == "waiting_tool":
        assert record.pending_call_id == "c_1"


async def test_shielded_persist_tasks_are_awaited_before_the_pool_may_close():
    release, started = asyncio.Event(), asyncio.Event()

    class SlowFinish(MemoryRunStore):
        async def finish(self, run_id, status, lease, pending_call_id=None):
            started.set()
            await release.wait()
            await super().finish(run_id, status, lease, pending_call_id)

    store = SlowFinish()
    app = make_app(ScriptedChatModel([ai_text("تم")]), store)
    call = await disconnect_at(app, "answer", wait=False)  # the response itself waits for the slow finish
    await asyncio.wait_for(started.wait(), 5)
    drained = asyncio.create_task(app.state.drain())
    await asyncio.sleep(0.05)
    assert not drained.done()
    release.set()
    await asyncio.wait_for(drained, 5)
    with contextlib.suppress(asyncio.CancelledError):
        await asyncio.wait_for(call, 5)
    assert next(iter(store.records.values())).status == "done"


async def test_a_failing_store_finish_is_logged_redacted_and_the_stream_still_ends(caplog):
    caplog.set_level(logging.INFO)

    class BrokenFinish(MemoryRunStore):
        async def finish(self, *args, **kwargs):
            raise ConnectionError(LEAKY)

    async with client_for(make_app(ScriptedChatModel([ai_text("تم")]), BrokenFinish())) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert events[-1][0] == "done"
    for secret in ("sk-secret", "u:pw@h", "postgresql://"):
        assert secret not in caplog.text
    assert "ConnectionError" in caplog.text


def age(store, run_id, status="running"):
    record = store.records[run_id]
    record.status = status
    record.updated_at -= timedelta(seconds=STALE_AFTER_SECONDS + 5)


async def test_a_stale_running_run_without_a_pending_call_can_be_continued_and_a_fresh_one_cannot():
    store = MemoryRunStore()
    model = ScriptedChatModel([ai_text("أول"), ai_text("ثاني")])
    async with client_for(make_app(model, store)) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)[0][1]["run_id"]
        store.records[run_id].status = "running"  # a crash left it running, but only just now
        again = {**BODY, "run_id": run_id, "message": "وبعدين؟"}
        assert (await client.post("/v1/runs", json=again, headers=HEADERS)).status_code == 409
        age(store, run_id)
        events = parse_sse((await client.post("/v1/runs", json=again, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"} and store.records[run_id].status == "done"


async def test_a_stale_running_run_with_a_pending_call_only_resumes():
    store = MemoryRunStore()
    model = ScriptedChatModel([ai_tool_call(TASKS, {}, "c_1"), ai_text("تم")])
    async with client_for(make_app(model, store)) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)[0][1]["run_id"]
        age(store, run_id)
        assert (await client.post("/v1/runs", json={**BODY, "run_id": run_id}, headers=HEADERS)).status_code == 409
        assert (await client.post(f"/v1/runs/{run_id}/resume", json={**RESUME_C1, "call_id": "c_x"}, headers=HEADERS)).status_code == 409
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}


async def test_a_late_resume_with_the_old_call_id_cannot_apply_to_a_newer_interrupt():
    class MovesOn(MemoryRunStore):
        """Between the service's checkpoint check and its acquire, the run moves on to the next pending call."""

        async def acquire(self, run_id, allowed, **kwargs):
            if getattr(self, "moved", False) is False:
                self.moved = True
                self.records[run_id].pending_call_id = "c_2"
            return await super().acquire(run_id, allowed, **kwargs)

    store = MovesOn()
    model = ScriptedChatModel([ai_tool_call(TASKS, {}, "c_1"), ai_text("x")])
    async with client_for(make_app(model, store)) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)[0][1]["run_id"]
        assert store.records[run_id].pending_call_id == "c_1"
        before = len(model.calls)
        assert (await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).status_code == 409
        assert len(model.calls) == before and store.records[run_id].status == "waiting_tool"


SCHEMA_TOOL = {**READ_TOOL, "input_schema": {"type": "object", "properties": {"a": {"$ref": "#/definitions/missing"}}}}


async def test_an_unexpected_validation_failure_answers_invalid_arguments_and_the_thread_stays_usable(caplog):
    caplog.set_level(logging.INFO)
    model = ScriptedChatModel([ai_tool_call(TASKS, {"a": 1}, "c_1"), ai_text("تعذر")])
    async with client_for(make_app(model)) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh({**BODY, "tools": [SCHEMA_TOOL]}), headers=HEADERS)).text)
    assert events[-1][1] == {"status": "done"}
    [reply] = [m for m in model.calls[-1] if isinstance(m, ToolMessage)]
    assert reply.tool_call_id == "c_1" and json.loads(reply.content)["error"]["code"] == "invalid_arguments"
    assert "missing" not in reply.content and "Unresolvable" not in reply.content and "missing" not in caplog.text


async def test_continuing_a_thread_cuts_short_tool_calls_that_never_got_a_reply():
    checkpointer = InMemorySaver()
    store = MemoryRunStore()
    model = ScriptedChatModel([ai_text("من جديد")])
    async with client_for(make_app(model, store, checkpointer)) as client:
        record = await store.create(new_id(), "t1", "42")
        await store.finish(record.run_id, "failed", record.lease)
        graph = build_graph(model, checkpointer, IDENTITY)  # the thread a cancel left behind: a plan checkpoint, no interrupt, no reply
        await graph.aupdate_state(run_config(record.run_id, 6), {**request_state(RunRequest.model_validate(fresh())), "messages": [ai_tool_call(TASKS, {}, "c_9")]}, as_node="plan")
        events = parse_sse((await client.post("/v1/runs", json={**BODY, "run_id": record.run_id, "message": "كمّل"}, headers=HEADERS)).text)
    assert events[-1][1] == {"status": "done"}
    sent = model.calls[-1]
    index = next(i for i, m in enumerate(sent) if isinstance(m, AIMessage) and m.tool_calls)
    reply = sent[index + 1]
    assert isinstance(reply, ToolMessage) and reply.tool_call_id == "c_9"
    assert json.loads(reply.content)["error"]["code"] == "interrupted"
    assert sent[index + 2].type == "human"


async def test_a_settled_waiting_status_is_stored_as_is_even_when_the_checkpoint_cannot_be_read(monkeypatch):
    from webvue_ai_service import service

    class Probed(InMemorySaver):
        async def aget_tuple(self, config):
            if config["configurable"].get("probe"):
                msg = "checkpoint unreadable"
                raise ConnectionError(msg)
            return await super().aget_tuple(config)

    real = service.run_config
    monkeypatch.setattr(service, "run_config", lambda run_id, steps, *rest: {**real(run_id, steps, *rest), "configurable": {**real(run_id, steps, *rest)["configurable"], "probe": steps == 1}})
    store = MemoryRunStore()
    async with client_for(make_app(ScriptedChatModel([ai_tool_call(TASKS, {}, "c_1")]), store, Probed())) as client:
        events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert events[-1][1] == {"status": "waiting_tool"}
    assert store.records[events[0][1]["run_id"]].status == "waiting_tool"


async def test_the_response_closes_its_generator_when_the_send_is_cancelled_even_while_something_still_holds_it():
    from webvue_ai_service.service import ClosingStreamingResponse

    closed = asyncio.Event()

    async def body():
        try:
            yield b"event: run\n\n"
            await asyncio.Event().wait()
        finally:
            closed.set()

    generator, blocked = body(), asyncio.Event()  # the test keeps ``generator`` alive: nothing but the response may close it

    async def send(message):
        if message["type"] == "http.response.body" and message.get("body"):
            blocked.set()
            await asyncio.Event().wait()

    async def receive():
        await asyncio.Event().wait()

    scope = {"type": "http", "asgi": {"spec_version": "2.4"}}
    call = asyncio.create_task(ClosingStreamingResponse(generator, media_type="text/event-stream")(scope, receive, send))
    await asyncio.wait_for(blocked.wait(), 5)
    call.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await call
    assert closed.is_set()
