"""Persisted AI generation drains must survive a fresh application instance."""

import re
from dataclasses import replace

import httpx
from langgraph.checkpoint.memory import InMemorySaver

from tests.fakes import ScriptedChatModel, ai_text
from tests.test_service import HEADERS, SETTINGS, fresh
from liwan_ai_service.service import create_app
from liwan_ai_service.store import MemoryRunStore

TOKEN = "synthetic-release-token-" * 2
ADMIN = {"x-liwan-service-token": TOKEN}
OWNER = {**HEADERS, **ADMIN}


def client(store, checkpoints, generation):
    settings = replace(SETTINGS, service_token=TOKEN, generation_id=generation)
    app = create_app(ScriptedChatModel([ai_text("done")], title_responses=[ai_text("title")]), store, checkpoints, settings)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


async def test_drained_generation_stays_closed_after_restart_and_another_generation_can_accept():
    store, checkpoints = MemoryRunStore(), InMemorySaver()
    async with client(store, checkpoints, "old-ai") as old:
        before = (await old.post("/internal/release/drain", headers=ADMIN)).json()
        assert before["drained"] and not before["accepting"]
    async with client(store, checkpoints, "old-ai") as restarted, client(store, checkpoints, "new-ai") as new:
        status = (await restarted.get("/internal/release/readiness", headers=ADMIN)).json()
        assert status["drained"] and not status["accepting"]
        assert (await restarted.post("/v1/runs", json=fresh(), headers=OWNER)).status_code == 503
        assert (await new.post("/v1/runs", json=fresh(), headers=OWNER)).status_code == 200
        ready = (await new.get("/internal/release/readiness", headers=ADMIN)).json()
        assert status["state_id"] == ready["state_id"]
        assert re.fullmatch("state_[a-f0-9]{32}", ready["state_id"])
        assert status["generation_id"] == "old-ai" and ready["generation_id"] == "new-ai"


async def test_release_administration_requires_generation_identity_even_with_valid_token():
    app = create_app(ScriptedChatModel([]), MemoryRunStore(), InMemorySaver(), replace(SETTINGS, service_token=TOKEN))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as http:
        for method, path in (("GET", "/internal/release/readiness"), ("POST", "/internal/release/drain")):
            assert (await http.request(method, path, headers=ADMIN)).status_code == 503


async def test_state_identity_is_generated_per_store_and_never_taken_from_generation_label():
    first, second = MemoryRunStore(), MemoryRunStore()
    async with client(first, InMemorySaver(), "same-label") as a, client(second, InMemorySaver(), "same-label") as b:
        ea = (await a.get("/internal/release/readiness", headers=ADMIN)).json()
        eb = (await b.get("/internal/release/readiness", headers=ADMIN)).json()
        assert ea["state_id"] != eb["state_id"]
        assert ea["generation_id"] == eb["generation_id"] == "same-label"


async def test_admission_is_counted_before_waiting_for_persisted_generation_gate():
    import asyncio

    store, checkpoints = MemoryRunStore(), InMemorySaver()
    entered, resume = asyncio.Event(), asyncio.Event()
    real_gate = store.generation_draining
    first = True

    async def paused_gate(generation):
        nonlocal first
        if first:
            first = False
            entered.set()
            await resume.wait()
        return await real_gate(generation)

    store.generation_draining = paused_gate
    async with client(store, checkpoints, "old-ai") as http:
        starting = asyncio.create_task(http.post("/v1/runs", json=fresh(), headers=OWNER))
        await asyncio.wait_for(entered.wait(), 5)
        draining = (await http.post("/internal/release/drain", headers=ADMIN)).json()
        assert draining["local_requests"] == 1 and draining["drained"] is False
        resume.set()
        assert (await starting).status_code == 503
        assert store.records == {}
        final = (await http.get("/internal/release/readiness", headers=ADMIN)).json()
        assert final["drained"] and final["local_requests"] == 0
