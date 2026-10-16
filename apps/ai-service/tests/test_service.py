import asyncio
import contextlib
import json
import logging

import httpx
import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

from nasq_ai_service import service
from nasq_ai_service.service import create_app
from nasq_ai_service.settings import Settings
from nasq_ai_service.store import MemoryRunStore
from tests.fakes import FailingChatModel, ScriptedChatModel, SlowChatModel, ai_blocks, ai_text, ai_tool_call
from tests.test_contracts import DRAFT_TOOL, READ_TOOL

HEADERS = {"X-Nasq-Tenant": "t1", "X-Nasq-User": "42"}
BODY = {
    "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "وش مهامي؟", "context": {"page": "project", "id": 1},
    "tools": [READ_TOOL, DRAFT_TOOL], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60},
}


def parse_sse(text: str):
    events = []
    for block in text.strip().split("\n\n"):
        name = data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
        events.append((name, data))
    return events


@pytest.fixture
def client_factory():
    def make(responses):
        settings = Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_ALLOW_MEMORY_STATE": "true"})
        app = create_app(ScriptedChatModel(responses), MemoryRunStore(), InMemorySaver(), settings)
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")
    return make


async def test_run_streams_a_tool_request_then_resumes_to_an_answer(client_factory):
    async with client_factory([ai_tool_call("pmo__list_my_tasks", {"limit": 5}, "c_1"), ai_text("عندك مهمة: تقرير")]) as client:
        response = await client.post("/v1/runs", json=BODY, headers=HEADERS)
        assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
        events = parse_sse(response.text)
        assert events[0][0] == "run" and events[0][1]["run_id"].startswith("r_")
        run_id = events[0][1]["run_id"]
        names = [name for name, _ in events]
        assert names[-2:] == ["tool_request", "done"]
        assert events[-1][1] == {"status": "waiting_tool"}
        assert events[-2][1]["call_id"] == "c_1" and events[-2][1]["kind"] == "read"

        status = (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()
        assert status["status"] == "waiting_tool" and status["pending"]["tool"] == "pmo.list_my_tasks"
        assert status["messages"][0] == {"role": "user", "content": "وش مهامي؟"}

        resumed = await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "result": {"ok": True, "data": {"items": [{"id": 5, "name": "تقرير"}], "total": 1}}}, headers=HEADERS)
        events = parse_sse(resumed.text)
        names = [name for name, _ in events]
        assert "token" in names and names[-2:] == ["answer", "done"]
        answer = dict(events)["answer"]
        assert answer["text"] == "عندك مهمة: تقرير" and answer["records"] == [{"type": "task", "id": 5, "label": "تقرير"}]
        assert events[-1][1] == {"status": "done"}
        assert (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()["status"] == "done"


async def test_the_answer_lists_only_the_returned_records_it_names(client_factory):
    rows = {"ok": True, "data": {"items": [{"id": 5, "name": "تقرير"}, {"id": 6, "name": "ميزانية"}], "total": 2}}
    async with client_factory([ai_tool_call("pmo__list_my_tasks", {"limit": 5}, "c_1"), ai_text("المتأخرة هي **تقرير** فقط")]) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "result": rows}, headers=HEADERS)).text)
        assert dict(events)["answer"]["records"] == [{"type": "task", "id": 5, "label": "تقرير"}]


async def test_write_and_draft_requests_wait_for_the_user(client_factory):
    async with client_factory([ai_tool_call("pmo__draft_project", {"name": "بوابة"}, "c_1"), ai_text("ألغيت")]) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "waiting_user"}
        run_id = events[0][1]["run_id"]
        resumed = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "result": {"ok": False, "decision": "rejected"}}, headers=HEADERS)).text)
        assert resumed[-1][1] == {"status": "done"}


async def test_resume_with_a_wrong_call_id_is_409_and_changes_nothing(client_factory):
    async with client_factory([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("x")]) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        response = await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_other", "result": {"ok": True, "data": {}}}, headers=HEADERS)
        assert response.status_code == 409
        assert (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()["pending"]["call_id"] == "c_1"


async def test_another_tenant_or_user_cannot_see_or_resume_the_run(client_factory):
    async with client_factory([ai_tool_call("pmo__list_my_tasks", {}, "c_1")]) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        for headers in ({"X-Nasq-Tenant": "t2", "X-Nasq-User": "42"}, {"X-Nasq-Tenant": "t1", "X-Nasq-User": "7"}):
            assert (await client.get(f"/v1/runs/{run_id}", headers=headers)).status_code == 404
            assert (await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "result": {"ok": True, "data": {}}}, headers=headers)).status_code == 404


async def test_headers_must_match_the_body(client_factory):
    async with client_factory([ai_text("x")]) as client:
        response = await client.post("/v1/runs", json=BODY, headers={"X-Nasq-Tenant": "t9", "X-Nasq-User": "42"})
        assert response.status_code == 422
        response = await client.post("/v1/runs", json=BODY)
        assert response.status_code == 422


async def test_limit_reached_is_an_event_and_a_status(client_factory):
    responses = [ai_tool_call("pmo__list_my_tasks", {}, f"c_{i}") for i in range(1, 4)]
    async with client_factory(responses) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        for call in ("c_1", "c_2"):
            events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": call, "result": {"ok": True, "data": {"items": [], "total": 0}}}, headers=HEADERS)).text)
        assert ("limit_reached", {"limit": "max_tool_calls"}) in events
        assert events[-1][1] == {"status": "limit_reached"}


async def test_provider_failure_streams_an_error_and_the_run_can_be_reused(client_factory):
    class Exploding(ScriptedChatModel):
        def _next(self, messages):
            if self.responses and self.responses[0].content == "boom":
                self.responses.pop(0)
                raise ConnectionError("provider down")
            return super()._next(messages)

    settings = Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_ALLOW_MEMORY_STATE": "true"})
    model = Exploding(responses=[ai_text("boom"), ai_text("رجعت")])
    app = create_app(model, MemoryRunStore(), InMemorySaver(), settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
        run_id = events[0][1]["run_id"]
        assert ("error", {"code": "provider_unavailable", "message": "The AI provider is unavailable: ConnectionError"}) in events
        assert events[-1][1] == {"status": "failed"}
        again = parse_sse((await client.post("/v1/runs", json={**BODY, "run_id": run_id}, headers=HEADERS)).text)
        assert again[0][1]["run_id"] == run_id and again[-1][1] == {"status": "done"}


async def test_healthz(client_factory):
    async with client_factory([]) as client:
        assert (await client.get("/healthz")).json() == {"ok": True}


SETTINGS = Settings.from_env({"AI_PROVIDER": "ollama", "AI_MODEL": "m", "AI_ALLOW_MEMORY_STATE": "true"})
LEAKY = "sk-secret postgresql://u:pw@h/db"
RESUME_C1 = {"call_id": "c_1", "result": {"ok": True, "data": {"items": [], "total": 0}}}


def make_client(model, store=None):
    app = create_app(model, store or MemoryRunStore(), InMemorySaver(), SETTINGS)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def test_block_list_content_streams_tokens_and_answers_with_a_string():
    # langchain_anthropic returns content as blocks once tools are bound.
    plan = AIMessage(content=[{"type": "text", "text": "سأقرأ"}, {"type": "tool_use", "id": "c_1", "name": "pmo__list_my_tasks", "input": {}}],
                     tool_calls=[{"name": "pmo__list_my_tasks", "args": {}, "id": "c_1", "type": "tool_call"}])
    async with make_client(ScriptedChatModel([plan, ai_blocks("عندك ", "مهمة")])) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
        run_id = events[0][1]["run_id"]
        assert events[-1][1] == {"status": "waiting_tool"}
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).text)
        tokens = [data["text"] for name, data in events if name == "token"]
        assert tokens == ["عندك ", "مهمة"] and all(isinstance(text, str) for text in tokens)
        assert dict(events)["answer"]["text"] == "عندك مهمة"
        messages = (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()["messages"]
        assert messages[-1] == {"role": "assistant", "content": "عندك مهمة"}


async def test_a_dropped_client_never_leaves_the_run_running():
    started, store = asyncio.Event(), MemoryRunStore()
    async with make_client(SlowChatModel([], started=started), store) as client:
        task = asyncio.create_task(client.post("/v1/runs", json=BODY, headers=HEADERS))
        await asyncio.wait_for(started.wait(), 5)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        [record] = store.records.values()
        for _ in range(100):
            if record.status != "running":
                break
            await asyncio.sleep(0.02)
        assert record.status == "failed"


async def test_a_dropped_client_after_the_tool_request_keeps_the_run_resumable():
    store = MemoryRunStore()
    async with make_client(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("x")]), store) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "waiting_tool"}
        assert store.records[events[0][1]["run_id"]].status == "waiting_tool"


async def test_two_concurrent_resumes_of_one_call_run_the_model_once():
    model = ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("تم")])
    async with make_client(model) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        before = len(model.calls)
        first, second = await asyncio.gather(*(client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS) for _ in range(2)))
        assert sorted([first.status_code, second.status_code]) == [200, 409]
        assert len(model.calls) == before + 1


async def test_two_concurrent_continuations_of_a_finished_run_start_one_turn():
    model = ScriptedChatModel([ai_text("أول"), ai_text("ثاني"), ai_text("ثالث")])
    async with make_client(model) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        before = len(model.calls)
        again = {**BODY, "run_id": run_id, "message": "وبعدين؟"}
        first, second = await asyncio.gather(*(client.post("/v1/runs", json=again, headers=HEADERS) for _ in range(2)))
        assert sorted([first.status_code, second.status_code]) == [200, 409]
        assert len(model.calls) == before + 1


async def test_continuing_a_waiting_run_is_409():
    async with make_client(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1")])) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        assert (await client.post("/v1/runs", json={**BODY, "run_id": run_id}, headers=HEADERS)).status_code == 409


async def test_a_run_continues_cleanly_after_the_tool_limit_stopped_it():
    responses = [ai_tool_call("pmo__list_my_tasks", {}, f"c_{i}") for i in range(1, 4)] + [ai_text("من جديد")]
    model = ScriptedChatModel(responses)
    async with make_client(model) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        for call in ("c_1", "c_2"):
            events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": call, "result": {"ok": True, "data": {}}}, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "limit_reached"}
        events = parse_sse((await client.post("/v1/runs", json={**BODY, "run_id": run_id, "message": "كمّل"}, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}
        sent = model.calls[-1]
        answered = {m.tool_call_id for m in sent if m.type == "tool"}
        asked = {call["id"] for m in sent if isinstance(m, AIMessage) for call in m.tool_calls}
        assert asked == {"c_1", "c_2", "c_3"} and asked <= answered


async def test_a_continued_run_takes_the_new_tools_locale_and_context():
    model = ScriptedChatModel([ai_text("أول"), ai_text("second")])
    async with make_client(model) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)[0][1]["run_id"]
        new = {**BODY, "run_id": run_id, "locale": "en", "message": "and now?", "tools": [DRAFT_TOOL], "context": {"page": "task", "id": 9}}
        await client.post("/v1/runs", json=new, headers=HEADERS)
        system = [m for m in model.calls[-1] if m.type == "system"]
        assert len(system) == 1
        text = system[0].content
        assert "briefly in English" in text and "pmo__draft_project" in text and "pmo__list_my_tasks" not in text and "task 9" in text
        assert [tool["function"]["name"] for tool in model.bound_tools] == ["pmo__draft_project"]


async def test_error_events_carry_a_fixed_message_and_the_class_never_the_exception_text(caplog):
    caplog.set_level(logging.INFO)
    async with make_client(FailingChatModel([], error=ConnectionError(LEAKY))) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
    [error] = [data for name, data in events if name == "error"]
    assert error == {"code": "provider_unavailable", "message": "The AI provider is unavailable: ConnectionError"}
    for secret in ("sk-secret", "u:pw@h", "postgresql://"):
        assert secret not in json.dumps(events) and secret not in caplog.text
    assert "ConnectionError" in caplog.text  # the detail is logged server-side, redacted


async def test_a_non_provider_failure_is_internal():
    async with make_client(FailingChatModel([], error=KeyError(LEAKY))) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
    assert ("error", {"code": "internal", "message": "The AI service hit an internal error: KeyError"}) in events


async def test_a_provider_timeout_is_a_failure_not_the_run_timeout():
    async with make_client(FailingChatModel([], error=TimeoutError("read timeout"))) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
    assert [name for name, _ in events if name == "limit_reached"] == []
    assert events[-1][1] == {"status": "failed"} and events[-2][1]["code"] == "provider_unavailable"


async def test_the_run_timeout_is_a_limit_not_an_error(monkeypatch):
    real_timeout = asyncio.timeout
    monkeypatch.setattr(service.asyncio, "timeout", lambda _seconds: real_timeout(0.05))
    async with make_client(SlowChatModel([])) as client:
        events = parse_sse((await client.post("/v1/runs", json=BODY, headers=HEADERS)).text)
    assert ("limit_reached", {"limit": "timeout"}) in events and events[-1][1] == {"status": "limit_reached"}
