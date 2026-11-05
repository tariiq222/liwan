"""Coordinator-only isolated PostgreSQL proof; no Odoo or external model provider is used."""
import asyncio
import json
import os
import sys
from dataclasses import replace

import httpx
import psycopg
import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import sql
from psycopg.conninfo import make_conninfo

from liwan_ai_service.service import create_app, graph_factory
from liwan_ai_service.store import StateCompatibilityError, initialize_tenant
from tests.fakes import ScriptedChatModel, SeededStates, ai_text, ai_tool_call, open_test_state
from tests.test_release_continuity import ADMIN, OWNER, TOKEN
from tests.test_service import RESUME_C1, SETTINGS, fresh, parse_sse

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs an isolated AI_TEST_DATABASE_URL")

CLAIM_PROCESS = '''
import asyncio, json, os
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool
from liwan_ai_service.store import PostgresRunStore
async def main():
    pool = AsyncConnectionPool(os.environ["AI_TEST_DATABASE_URL"], min_size=1, max_size=5,
                               kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()
    try:
        store = PostgresRunStore(pool)
        lease = await store.acquire(os.environ["AI_TEST_RUN_ID"], ("waiting_user",), stale_after_seconds=660,
                                    pending_call_id="c_1", to_status="executing")
        print(json.dumps({"claimed": lease is not None}))
    finally:
        await pool.close()
asyncio.run(main())
'''


@pytest.fixture
async def tenant():
    """A bootstrapped tenant schema opened as the runtime opens it (control state included), ``(store, checkpointer, control, run_ids, conninfo)``."""
    from uuid import uuid4

    database_url = os.environ["AI_TEST_DATABASE_URL"]
    schema = f"release_{uuid4().hex[:12]}"
    admin = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    await admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    isolated = make_conninfo(database_url, options=f"-c search_path={schema}")
    await initialize_tenant(isolated)
    store, checkpoints, control, close = await open_test_state(isolated)
    run_ids = []
    try:
        yield store, checkpoints, control, run_ids, isolated
    finally:
        async with store.pool.connection() as conn, conn.transaction():
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                await conn.execute(f"DELETE FROM {table} WHERE thread_id = ANY(%s)", (run_ids,))
            await conn.execute("DELETE FROM ai_runs WHERE run_id = ANY(%s)", (run_ids,))
        await close()
        await admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        await admin.close()


async def claim_from_process(run_id, conninfo):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-c", CLAIM_PROCESS, env={**os.environ, "AI_TEST_RUN_ID": run_id, "AI_TEST_DATABASE_URL": conninfo},
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), 15)
    assert process.returncode == 0, f"claim child failed: exit {process.returncode}, stderr bytes {len(stderr)}"
    return json.loads(stdout)["claimed"]


async def test_two_processes_share_one_claim_and_two_compatible_apps_preserve_checkpoint_while_draining(tenant):
    store, checkpoints, control, run_ids, isolated = tenant
    settings = replace(SETTINGS, service_token=TOKEN, generation_id="old-ai")
    old_model = ScriptedChatModel([ai_tool_call("pmo__draft_project", {"name": "x"}, "c_1")])
    new_model = ScriptedChatModel([ai_text("تم")], title_responses=[ai_text("عنوان")])
    old = create_app(old_model, SeededStates(graph_factory(old_model, settings), store=store, checkpointer=checkpoints), control, settings)
    new = create_app(
        new_model, SeededStates(graph_factory(new_model, settings), store=store, checkpointer=checkpoints), control,
        replace(settings, generation_id="new-ai"),
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=old), base_url="http://old") as a, \
            httpx.AsyncClient(transport=httpx.ASGITransport(app=new), base_url="http://new") as b:
        run_id = parse_sse((await a.post("/v1/runs", json=fresh(), headers=OWNER)).text)[0][1]["run_id"]
        run_ids.append(run_id)
        assert sorted(await asyncio.gather(claim_from_process(run_id, isolated), claim_from_process(run_id, isolated))) == [False, True]
        evidence = (await a.post("/internal/release/drain", headers=ADMIN)).json()
        assert evidence["drained"] is False and evidence["claimed_writes"] >= 1
        assert evidence["activity_scope"] == "tenant_states"
        assert (await b.post(f"/v1/runs/{run_id}/claim", json={"call_id": "c_1"}, headers=OWNER)).status_code == 409
        response = await b.post(f"/v1/runs/{run_id}/resume", json=RESUME_C1, headers=OWNER)
        assert response.status_code == 200 and parse_sse(response.text)[-1][1] == {"status": "done"}
        assert (await store.get(run_id)).status == "done"


async def test_runtime_and_operator_refuse_mismatched_version_without_tenant_ddl(tenant):
    store, _, _, _, isolated = tenant
    from liwan_ai_service.store import validate_tenant

    async with store.pool.connection() as conn:
        before = await (await conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")).fetchall()
        await conn.execute("UPDATE ai_tenant_schema SET state_version = 'future'")
    try:
        with pytest.raises(StateCompatibilityError, match="ai_state_incompatible"):
            async with await psycopg.AsyncConnection.connect(isolated, autocommit=True) as conn:
                await validate_tenant(conn, len(AsyncPostgresSaver.MIGRATIONS) - 1)
        with pytest.raises(StateCompatibilityError, match="ai_state_incompatible"):
            await initialize_tenant(isolated)  # the operator bootstrap validates an existing schema, it never repairs it
        async with store.pool.connection() as conn:
            assert await (await conn.execute("SELECT v FROM checkpoint_migrations ORDER BY v")).fetchall() == before
            assert await (await conn.execute("SELECT state_version FROM ai_tenant_schema")).fetchone() == ("future",)
            assert before[-1] == (len(AsyncPostgresSaver.MIGRATIONS) - 1,)
    finally:
        async with store.pool.connection() as conn:
            await conn.execute("UPDATE ai_tenant_schema SET state_version = '1'")
