"""Release retirement must preserve the existing run/claim/checkpoint contract."""
from dataclasses import replace

import httpx
from langgraph.checkpoint.memory import InMemorySaver

from liwan_ai_service.service import create_app
from liwan_ai_service.store import MemoryRunStore
from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
from tests.test_service import HEADERS, RESUME_C1, SETTINGS, fresh, parse_sse

TOKEN = "t" * 30
ADMIN = {"x-liwan-service-token": TOKEN}
OWNER = {**HEADERS, **ADMIN}


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def test_internal_drain_requires_a_configured_service_token():
    for settings, expected in ((SETTINGS, 503), (replace(SETTINGS, service_token=TOKEN, generation_id="old-ai"), 401)):
        app = create_app(ScriptedChatModel([]), MemoryRunStore(), InMemorySaver(), settings)
        async with client(app) as http:
            assert (await http.post("/internal/release/drain")).status_code == expected


async def test_drain_blocks_new_work_but_allows_claimed_effect_to_settle_across_compatible_apps():
    store, checkpoints = MemoryRunStore(), InMemorySaver()
    settings = replace(SETTINGS, service_token=TOKEN, generation_id="old-ai")
    old = create_app(ScriptedChatModel([ai_tool_call("pmo__draft_project", {"name": "x"}, "c_1")]), store, checkpoints, settings)
    new = create_app(ScriptedChatModel([ai_text("تم")]), store, checkpoints, replace(settings, generation_id="new-ai"))
    async with client(old) as a, client(new) as b:
        run_id = parse_sse((await a.post("/v1/runs", json=fresh(), headers=OWNER)).text)[0][1]["run_id"]
        path = f"/v1/runs/{run_id}"
        assert (await a.post(path + "/claim", json={"call_id": "c_1"}, headers=OWNER)).status_code == 200
        draining = await a.post("/internal/release/drain", headers=ADMIN)
        assert draining.status_code == 200
        assert draining.json()["drained"] is False and draining.json()["active_runs"] == 1
        assert (await a.post("/v1/runs", json=fresh(), headers=OWNER)).status_code == 503
        assert (await a.post(path + "/claim", json={"call_id": "c_1"}, headers=OWNER)).status_code == 503
        assert (await b.post(path + "/claim", json={"call_id": "c_1"}, headers=OWNER)).status_code == 409
        await b.post("/internal/release/drain", headers=ADMIN)
        resumed = await b.post(path + "/resume", json=RESUME_C1, headers=OWNER)
        assert resumed.status_code == 200 and parse_sse(resumed.text)[-1][1] == {"status": "done"}
        ready = (await a.get("/internal/release/readiness", headers=ADMIN)).json()
        assert ready["drained"] is True and ready["active_runs"] == 0
        assert (await b.post(path + "/resume", json=RESUME_C1, headers=OWNER)).status_code == 409


async def test_an_incompatible_bff_state_version_is_refused_before_any_run_is_created():
    store = MemoryRunStore()
    app = create_app(ScriptedChatModel([ai_text("x")]), store, InMemorySaver(), SETTINGS)
    async with client(app) as http:
        response = await http.post("/v1/runs", json=fresh(), headers={**HEADERS, "x-liwan-ai-state-version": "future"})
        assert response.status_code == 503
        assert store.records == {}


async def test_active_stream_and_its_settlement_prevent_retirement():
    import asyncio
    import contextlib

    from tests.fakes import SlowChatModel

    started = asyncio.Event()
    store = MemoryRunStore()
    app = create_app(SlowChatModel([], started=started), store, InMemorySaver(), replace(SETTINGS, service_token=TOKEN, generation_id="old-ai"))
    async with client(app) as http:
        call = asyncio.create_task(http.post("/v1/runs", json=fresh(), headers=OWNER))
        await asyncio.wait_for(started.wait(), 5)
        evidence = (await http.post("/internal/release/drain", headers=ADMIN)).json()
        assert evidence["drained"] is False and evidence["running"] == 1 and evidence["local_requests"] == 1
        call.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await call
        await app.state.drain()
        after = (await http.get("/internal/release/readiness", headers=ADMIN)).json()
        assert after["drained"] is True and after["running"] == 0 and after["local_requests"] == 0


async def test_automatic_pending_read_remains_in_drain_until_its_existing_result_settles():
    store = MemoryRunStore()
    app = create_app(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("تم"), ai_text("عنوان")]), store,
                     InMemorySaver(), replace(SETTINGS, service_token=TOKEN, generation_id="old-ai"))
    async with client(app) as http:
        run_id = parse_sse((await http.post("/v1/runs", json=fresh(), headers=OWNER)).text)[0][1]["run_id"]
        evidence = (await http.post("/internal/release/drain", headers=ADMIN)).json()
        assert evidence["drained"] is False and evidence["pending_reads"] == 1
        response = await http.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=OWNER)
        assert response.status_code == 200 and parse_sse(response.text)[-1][1] == {"status": "done"}
        assert (await http.get("/internal/release/readiness", headers=ADMIN)).json()["drained"] is True
