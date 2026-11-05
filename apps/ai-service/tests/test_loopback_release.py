"""Real HTTP, two runtime processes over one tenant database in the coordinator's AI scratch DB."""
import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from liwan_ai_service.control import open_control
from liwan_ai_service.store import initialize_tenant
from tests.test_release_continuity import ADMIN, OWNER
from tests.test_service import BODY, RESUME_C1, fresh, parse_sse

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs an isolated AI_TEST_DATABASE_URL")

SERVER = '''
import asyncio, os, sys
import uvicorn
from langchain_core.messages import HumanMessage
from liwan_ai_service.service import close_runtime_state, create_app, open_runtime_state
from liwan_ai_service.settings import Settings
from tests.fakes import ScriptedChatModel, ai_text, ai_tool_call
class DelayedScript(ScriptedChatModel):
    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
        if human and human.content == "slow-active":
            await asyncio.sleep(0.6)
        async for chunk in super()._astream(messages, stop, run_manager, **kwargs):
            yield chunk
async def main():
    responses = ([ai_tool_call("pmo__draft_project", {"name":"x"}, "c_1")] if sys.argv[2] == "old" else
                 [ai_text("claim completed"), ai_text("active finished")])
    settings = Settings.from_env({"AI_PROVIDER":"ollama", "AI_MODEL":"scripted-fake", "AI_DATABASE_URL":os.environ["AI_DATABASE_URL"],
        "AI_SERVICE_TOKEN":"t"*30, "AI_GENERATION_ID":sys.argv[2], "LIWAN_TENANCY_MODE":"shared",
        "LIWAN_TENANT_REGISTRY_PATH":os.environ["LIWAN_TENANT_REGISTRY_PATH"]})
    model = DelayedScript(responses, title_responses=[ai_text("title"), ai_text("active title")])
    states, control = await open_runtime_state(model, settings)
    app = create_app(model, states, control, settings)
    try:
        await uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="error", access_log=False)).serve()
    finally:
        await app.state.drain()
        await close_runtime_state(states, control)
asyncio.run(main())
'''


def tenant_database(suffix: str) -> str:
    """A throwaway tenant database beside the scratch one: the runtime maps tenant ``t1`` to it through the registry."""
    return f"ai_loopback_{suffix}"


async def wait_ready(client, process):
    for _ in range(100):
        assert process.returncode is None, f"HTTP fixture startup exit {process.returncode}"
        try:
            response = await client.get("/internal/release/readiness", headers=ADMIN)
            if response.status_code == 200:
                assert response.json()["state_version"] == "1"
                assert response.json()["activity_scope"] == "tenant_states"
                return
        except httpx.ConnectError:
            pass
        await asyncio.sleep(0.05)
    pytest.fail("HTTP fixture readiness timed out")


@pytest.fixture
async def runtimes(tmp_path):
    database_url = os.environ["AI_TEST_DATABASE_URL"]
    suffix = uuid4().hex[:12]
    tenant = tenant_database(suffix)
    control_schema = f"ai_loopback_control_{suffix}"
    processes = []
    logs = []
    conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    await conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(tenant)))
    await conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(control_schema)))
    control_conninfo = make_conninfo(database_url, options=f"-c search_path={control_schema}")
    control = await open_control(control_conninfo, initialize=True)
    await control.aclose()
    tenant_conninfo = make_conninfo(database_url, dbname=tenant)
    async with await psycopg.AsyncConnection.connect(tenant_conninfo, autocommit=True) as tenant_conn:
        await tenant_conn.execute("CREATE SCHEMA liwan_ai")  # provisioned by the operator script, never by the runtime
    await initialize_tenant(make_conninfo(tenant_conninfo, options="-c search_path=liwan_ai"))
    registry = tmp_path / "tenants.json"
    registry.write_text(
        json.dumps({"schemaVersion": 1, "snapshotRevision": 1, "targets": [{"tenantId": "t1", "database": tenant, "enabled": True}]}),
        encoding="utf-8",
    )
    env = {
        **os.environ, "AI_DATABASE_URL": control_conninfo,
        "LIWAN_TENANCY_MODE": "shared", "LIWAN_TENANT_REGISTRY_PATH": str(registry),
    }
    try:
        report_dir = Path("../../.superpowers")
        report_dir.mkdir(exist_ok=True)
        for port, mode in ((8618, "old"), (8619, "new")):
            log = (report_dir / f"ai-loopback-{mode}.log").open("wb")
            logs.append(log)
            process = await asyncio.create_subprocess_exec(sys.executable, "-c", SERVER, str(port), mode, env=env,
                                                           stdout=log, stderr=log)
            processes.append(process)
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8618", timeout=10) as old, \
                httpx.AsyncClient(base_url="http://127.0.0.1:8619", timeout=10) as new:
            await asyncio.gather(*(wait_ready(client, process) for client, process in zip((old, new), processes, strict=True)))
            yield old, new, tenant
    finally:
        for process in processes:
            if process.returncode is None:
                process.terminate()
        for process in processes:
            try:
                await asyncio.wait_for(process.wait(), 10)
            except TimeoutError:
                process.kill()
                await process.wait()
        for log in logs:
            log.close()
        await conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(tenant)))
        await conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(control_schema)))
        await conn.close()


async def test_real_http_processes_keep_one_claim_shared_checkpoint_and_active_stream_drain(runtimes):
    old, new, tenant = runtimes
    assert (await old.get("/internal/release/readiness")).status_code == 401
    incompatible = await old.post("/v1/runs", json=fresh(), headers={**OWNER, "x-liwan-ai-state-version": "future"})
    assert incompatible.status_code == 503
    response = await old.post("/v1/runs", json=fresh(), headers=OWNER)
    run_id = parse_sse(response.text)[0][1]["run_id"]
    path = f"/v1/runs/{run_id}"
    claims = await asyncio.gather(*(client.post(path + "/claim", json={"call_id":"c_1"}, headers=OWNER) for client in (old, new)))
    assert sorted(result.status_code for result in claims) == [200, 409]
    evidence = (await old.post("/internal/release/drain", headers=ADMIN)).json()
    assert evidence["state_version"] == "1" and evidence["claimed_writes"] == 1 and evidence["drained"] is False
    assert (await old.post("/v1/runs", json=fresh(), headers=OWNER)).status_code == 503
    assert (await new.post(path + "/claim", json={"call_id":"c_1"}, headers=OWNER)).status_code == 409
    resumed = await new.post(path + "/resume", json=RESUME_C1, headers=OWNER)
    assert resumed.status_code == 200 and parse_sse(resumed.text)[-1][1] == {"status":"done"}
    assert dict(parse_sse(resumed.text))["answer"]["text"] == "claim completed"
    assert (await old.get(path, headers=OWNER)).json()["status"] == "done"
    assert (await old.get("/internal/release/readiness", headers=ADMIN)).json()["drained"] is True

    chunks = []
    observed_active = False
    async with new.stream("POST", "/v1/runs", json=fresh({**BODY, "message":"slow-active"}), headers=OWNER) as streaming:
        assert streaming.status_code == 200
        async for chunk in streaming.aiter_text():
            chunks.append(chunk)
            if not observed_active and "event: run" in "".join(chunks):
                observed_active = True
                active = (await new.post("/internal/release/drain", headers=ADMIN)).json()
                assert active["drained"] is False and active["running"] == 1 and active["local_requests"] == 1
                # The other real process sees the shared tenant run too.
                assert (await old.get("/internal/release/readiness", headers=ADMIN)).json()["running"] == 1
    assert observed_active
    assert parse_sse("".join(chunks))[-1][1] == {"status":"done"}
    assert dict(parse_sse("".join(chunks)))["answer"]["text"] == "active finished"
    for client in (old, new):
        final = (await client.get("/internal/release/readiness", headers=ADMIN)).json()
        assert final["drained"] is True and final["active_runs"] == 0 and final["claimed_writes"] == 0
        # One pool per open tenant database, keyed by its name.
        assert "pool_size" in final["connections"][tenant]
