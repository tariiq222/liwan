"""The atomic claim of a write call (master plan, claim contract): one claimant wins, the resume then applies the claimed call."""
import asyncio
import json

import httpx
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_recovery import age
from tests.test_service import BODY, HEADERS, RESUME_C1, SETTINGS, fresh, parse_sse
from webvue_ai_service.service import create_app
from webvue_ai_service.store import MemoryRunStore

DRAFT = "pmo__draft_project"
CLAIM_C1 = {"call_id": "c_1"}
OTHER = {"X-WebVue-Tenant": "t1", "X-WebVue-User": "43"}


def make_client(responses, store=None):
    app = create_app(ScriptedChatModel(responses), store or MemoryRunStore(), InMemorySaver(), SETTINGS)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def start(client, tool=DRAFT):
    events = parse_sse((await client.post("/v1/runs", json=fresh(), headers=HEADERS)).text)
    assert events[-1][0] == "done"
    return events[0][1]["run_id"]


async def claim(client, run_id, body=CLAIM_C1, headers=HEADERS):
    return await client.post(f"/v1/runs/{run_id}/claim", json=body, headers=headers)


async def test_a_claim_moves_a_waiting_user_run_to_executing_and_a_second_claim_is_refused():
    store = MemoryRunStore()
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")], store) as client:
        run_id = await start(client)
        response = await claim(client, run_id)
        assert response.status_code == 200 and response.json() == {"ok": True}
        assert store.records[run_id].status == "executing" and store.records[run_id].pending_call_id == "c_1"
        assert (await claim(client, run_id)).status_code == 409
        status = (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()
        assert status["status"] == "executing" and status["pending"]["call_id"] == "c_1"


async def test_concurrent_claims_of_one_call_give_exactly_one_200():
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1")]) as client:
        run_id = await start(client)
        responses = await asyncio.gather(*(claim(client, run_id) for _ in range(6)))
    assert sorted(response.status_code for response in responses) == [200, 409, 409, 409, 409, 409]


async def test_a_read_call_is_not_claimable():
    store = MemoryRunStore()
    async with make_client([ai_tool_call("pmo__list_my_tasks", {}, "c_1")], store) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 409
        assert store.records[run_id].status == "waiting_tool"


async def test_a_wrong_call_id_is_refused_and_changes_nothing():
    store = MemoryRunStore()
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1")], store) as client:
        run_id = await start(client)
        before = (store.records[run_id].status, store.records[run_id].lease, store.records[run_id].updated_at)
        assert (await claim(client, run_id, {"call_id": "c_other"})).status_code == 409
        record = store.records[run_id]
        assert (record.status, record.lease, record.updated_at) == before
        assert (await claim(client, run_id)).status_code == 200


async def test_a_foreign_or_missing_run_is_not_found_and_a_bad_body_is_invalid():
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1")]) as client:
        run_id = await start(client)
        assert (await claim(client, run_id, headers=OTHER)).status_code == 404
        assert (await claim(client, "r_missing")).status_code == 404
        assert (await claim(client, run_id, {"call_id": ""})).status_code == 422
        assert (await claim(client, run_id, {"call_id": "c_1", "extra": 1})).status_code == 422
        assert (await claim(client, run_id)).status_code == 200


async def test_a_claim_then_a_resume_succeeds_and_a_second_resume_or_a_later_claim_is_refused():
    store = MemoryRunStore()
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")], store) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}
        assert (await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).status_code == 409
        assert (await claim(client, run_id)).status_code == 409


async def test_a_claim_after_a_resume_started_is_refused_and_two_resumes_after_a_claim_apply_once():
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")]) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        first, second = await asyncio.gather(*(client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS) for _ in range(2)))
        assert sorted([first.status_code, second.status_code]) == [200, 409]
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")]) as client:
        run_id = await start(client)
        assert (await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).status_code == 200
        assert (await claim(client, run_id)).status_code == 409


async def test_continuing_an_executing_run_is_refused_and_a_resume_with_another_call_id_too():
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1")]) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        assert (await client.post("/v1/runs", json={**BODY, "run_id": run_id}, headers=HEADERS)).status_code == 409
        assert (await client.post(f"/v1/runs/{run_id}/resume", json={**RESUME_C1, "call_id": "c_x"}, headers=HEADERS)).status_code == 409


async def test_a_rejected_resume_cannot_answer_an_executing_call_but_the_claimers_result_can():
    store = MemoryRunStore()
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")], store) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        rejected = {"call_id": "c_1", "result": {"ok": False, "decision": "rejected"}}
        assert (await client.post(f"/v1/runs/{run_id}/resume", json=rejected, headers=HEADERS)).status_code == 409
        assert store.records[run_id].status == "executing"
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}


async def test_a_rejected_resume_still_answers_a_waiting_user_call():
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")]) as client:
        run_id = await start(client)
        rejected = {"call_id": "c_1", "result": {"ok": False, "decision": "rejected"}}
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json=rejected, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}


async def test_a_stale_executing_run_is_never_claimed_or_resumed_again_and_reads_as_failed():
    store = MemoryRunStore()
    async with make_client([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("تم")], store) as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        fresh = (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()
        assert fresh["status"] == "executing" and fresh["pending"]["call_id"] == "c_1"
        age(store, run_id, "executing")
        assert (await claim(client, run_id)).status_code == 409
        assert (await client.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=HEADERS)).status_code == 409
        stale = (await client.get(f"/v1/runs/{run_id}", headers=HEADERS)).json()
        assert stale["status"] == "failed" and stale["pending"] is None
        assert store.records[run_id].status == "executing"  # computed at read time, nothing written


async def test_a_new_message_continues_a_stale_executing_run_and_the_model_learns_the_result_is_unknown():
    store = MemoryRunStore()
    model = ScriptedChatModel([ai_tool_call(DRAFT, {"name": "بوابة"}, "c_1"), ai_text("لا أعرف إن نُفذ")])
    app = create_app(model, store, InMemorySaver(), SETTINGS)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        run_id = await start(client)
        assert (await claim(client, run_id)).status_code == 200
        again = {**BODY, "run_id": run_id, "message": "هل تم؟"}
        assert (await client.post("/v1/runs", json=again, headers=HEADERS)).status_code == 409  # not stale yet
        age(store, run_id, "executing")
        events = parse_sse((await client.post("/v1/runs", json=again, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"} and store.records[run_id].status == "done"
    sent = model.calls[-1]
    index = next(i for i, m in enumerate(sent) if isinstance(m, AIMessage) and m.tool_calls)
    reply = sent[index + 1]
    assert isinstance(reply, ToolMessage) and reply.tool_call_id == "c_1"
    assert json.loads(reply.content)["error"]["code"] == "interrupted"
    assert sent[index + 2].type == "human" and sent[index + 2].content == "هل تم؟"


async def test_a_stale_executing_run_without_a_pending_call_can_be_continued():
    store = MemoryRunStore()
    async with make_client([ai_text("أول"), ai_text("ثاني")], store) as client:
        run_id = await start(client)  # answered: no interrupt in the checkpoint
        again = {**BODY, "run_id": run_id, "message": "وبعدين؟"}
        store.records[run_id].status = "executing"
        assert (await client.post("/v1/runs", json=again, headers=HEADERS)).status_code == 409  # not stale yet
        age(store, run_id, "executing")
        events = parse_sse((await client.post("/v1/runs", json=again, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"} and store.records[run_id].status == "done"


async def test_the_store_claims_only_waiting_user_with_the_same_pending_call():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    await store.finish(record.run_id, "waiting_user", record.lease, "c_1")
    assert await store.acquire(record.run_id, ("waiting_user",), stale_after_seconds=60, pending_call_id="c_2", to_status="executing") is None
    lease = await store.acquire(record.run_id, ("waiting_user",), stale_after_seconds=60, pending_call_id="c_1", to_status="executing")
    assert lease and store.records[record.run_id].status == "executing" and store.records[record.run_id].lease == lease
    await store.finish(record.run_id, "done", lease)  # the holder of an executing run's lease may settle it
    assert store.records[record.run_id].status == "done"
