"""Coordinator-only isolated PostgreSQL proof; no Odoo or external model provider is used."""
import asyncio
import json
import os
import sys
from dataclasses import replace

import httpx
import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
from tests.test_release_continuity import ADMIN, OWNER, TOKEN
from tests.test_service import BODY, RESUME_C1, SETTINGS, parse_sse
from webvue_ai_service.service import create_app
from webvue_ai_service.store import StateCompatibilityError, open_state

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs an isolated AI_TEST_DATABASE_URL")


@pytest.fixture
async def state():
    store, checkpoints, close = await open_state(os.environ["AI_TEST_DATABASE_URL"], initialize=True)
    run_ids = []
    try:
        yield store, checkpoints, run_ids
    finally:
        async with store.pool.connection() as conn, conn.transaction():
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                await conn.execute(f"DELETE FROM {table} WHERE thread_id = ANY(%s)", (run_ids,))
            await conn.execute("DELETE FROM ai_runs WHERE run_id = ANY(%s)", (run_ids,))
        await close()


CLAIM_PROCESS = '''
import asyncio, json, os
from webvue_ai_service.store import open_state
async def main():
    store, _, close = await open_state(os.environ["AI_TEST_DATABASE_URL"])
    try:
        lease = await store.acquire(os.environ["AI_TEST_RUN_ID"], ("waiting_user",), stale_after_seconds=660,
                                    pending_call_id="c_1", to_status="executing")
        print(json.dumps({"claimed": lease is not None}))
    finally:
        await close()
asyncio.run(main())
'''


async def claim_from_process(run_id):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-c", CLAIM_PROCESS, env={**os.environ, "AI_TEST_RUN_ID": run_id},
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), 15)
    assert process.returncode == 0, f"claim child failed: exit {process.returncode}, stderr bytes {len(stderr)}"
    return json.loads(stdout)["claimed"]


async def test_two_processes_share_one_claim_and_two_compatible_apps_preserve_checkpoint_while_draining(state):
    store, checkpoints, run_ids = state
    second_store, second_checkpoints, close = await open_state(os.environ["AI_TEST_DATABASE_URL"])
    settings = replace(SETTINGS, service_token=TOKEN, generation_id="old-ai")
    old = create_app(ScriptedChatModel([ai_tool_call("pmo__draft_project", {"name": "x"}, "c_1")]), store, checkpoints, settings)
    new = create_app(ScriptedChatModel([ai_text("تم")], title_responses=[ai_text("عنوان")]), second_store, second_checkpoints, replace(settings, generation_id="new-ai"))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=old), base_url="http://old") as a, \
                httpx.AsyncClient(transport=httpx.ASGITransport(app=new), base_url="http://new") as b:
            run_id = parse_sse((await a.post("/v1/runs", json=BODY, headers=OWNER)).text)[0][1]["run_id"]
            run_ids.append(run_id)
            assert sorted(await asyncio.gather(claim_from_process(run_id), claim_from_process(run_id))) == [False, True]
            evidence = (await a.post("/internal/release/drain", headers=ADMIN)).json()
            assert evidence["drained"] is False and evidence["claimed_writes"] >= 1
            assert evidence["activity_scope"] == "shared_state" and "pool_size" in evidence["connections"]
            assert (await b.post(f"/v1/runs/{run_id}/claim", json={"call_id": "c_1"}, headers=OWNER)).status_code == 409
            response = await b.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=OWNER)
            assert response.status_code == 200 and parse_sse(response.text)[-1][1] == {"status": "done"}
            assert (await store.get(run_id)).status == "done"
    finally:
        await close()


async def test_runtime_and_operator_refuse_mismatched_version_without_checkpoint_setup(state):
    store, _, _ = state
    async with store.pool.connection() as conn:
        before = await (await conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")).fetchall()
        await conn.execute("UPDATE ai_state_schema SET state_version = 'future'")
    try:
        for initialize in (False, True):
            with pytest.raises(StateCompatibilityError, match="incompatible"):
                await open_state(os.environ["AI_TEST_DATABASE_URL"], initialize=initialize)
        async with store.pool.connection() as conn:
            assert await (await conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")).fetchall() == before
            assert await (await conn.execute("SELECT state_version FROM ai_state_schema")).fetchone() == ("future",)
            assert before[-1] == (len(AsyncPostgresSaver.MIGRATIONS) - 1,)
    finally:
        async with store.pool.connection() as conn:
            await conn.execute("UPDATE ai_state_schema SET state_version = '1'")
