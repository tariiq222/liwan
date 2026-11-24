"""Opt-in live proof in two new preserved schemas of a local AI scratch database."""

import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from liwan_ai_service.control import open_control
from liwan_ai_service.store import initialize_tenant

pytestmark = pytest.mark.skipif(os.environ.get("AI_DURABLE_RELEASE_TEST") != "1", reason="explicit local scratch acceptance only")
TOKEN = "synthetic-durable-test-token-" * 2
CHILD = """
import asyncio, importlib.util, json, os, sys
from pathlib import Path
import liwan_ai_service
import liwan_ai_service.contracts
for name in ('settings', 'control', 'store', 'service'):
    path = Path(os.environ['AI_TEST_SOURCE_DIR']) / (name+'.py')
    spec = importlib.util.spec_from_file_location('liwan_ai_service.'+name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    setattr(liwan_ai_service, name, module)
    spec.loader.exec_module(module)
import httpx
from liwan_ai_service.service import close_runtime_state, create_app, open_runtime_state
from liwan_ai_service.settings import Settings
from tests.fakes import ScriptedChatModel, ai_text, platform_of
from tests.test_service import HEADERS, fresh
from tests.platform_file import platform_env

async def main():
    token = 'synthetic-durable-test-token-' * 2
    admin = {'x-liwan-service-token':token}
    settings = Settings.from_env({**platform_env("ollama", "scripted"),
        'AI_DATABASE_URL':os.environ['AI_TEST_DATABASE_URL'], 'AI_SERVICE_TOKEN':token, 'AI_GENERATION_ID':sys.argv[2],
        'LIWAN_TENANCY_MODE':'shared', 'LIWAN_TENANT_REGISTRY_PATH':os.environ['LIWAN_TENANT_REGISTRY_PATH']})
    model = ScriptedChatModel([ai_text('done')], title_responses=[ai_text('title')])
    states, control = await open_runtime_state(settings)
    app = create_app(platform_of(model, "ollama", "scripted"), states, control, settings)
    try:
        if sys.argv[1] == 'serve':
            import uvicorn
            server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=0, log_level='error', access_log=False))
            task = asyncio.create_task(server.serve())
            while not server.started:
                if task.done(): await task
                await asyncio.sleep(0.01)
            print(json.dumps({'port':server.servers[0].sockets[0].getsockname()[1], 'state_id':control.state_id}), flush=True)
            await task
        else:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://ai') as client:
                if sys.argv[1] == 'drain':
                    ready = (await client.post('/internal/release/drain', headers=admin)).json()
                else:
                    ready = (await client.get('/internal/release/readiness', headers=admin)).json()
                result = await client.post('/v1/runs', json=fresh(), headers={**HEADERS, **admin})
                print(json.dumps({'evidence':ready, 'start_status':result.status_code}))
    finally:
        await app.state.drain()
        await close_runtime_state(states, control)
asyncio.run(main())
"""


@pytest.fixture
async def scratch_states(tmp_path):
    database_url = os.environ["AI_TEST_DATABASE_URL"]
    config = conninfo_to_dict(database_url)
    if not config.get("dbname", "").startswith("liwan_scratch_") or config.get("host") not in ("127.0.0.1", "localhost", "::1"):
        pytest.fail("live AI proof requires an explicit local liwan_scratch_ database")
    conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    suffix = uuid4().hex[:12]
    schemas = [f"release_durable_1016_{suffix}_{name}" for name in ("a", "b")]
    states = []
    try:
        # Both runtimes of this proof serve one tenant database: the runtime resolves t1 through the registry.
        await conn.execute("CREATE SCHEMA IF NOT EXISTS liwan_ai")
        await initialize_tenant(make_conninfo(database_url, options="-c search_path=liwan_ai"))
        registry = tmp_path / "tenants.json"
        registry.write_text(
            json.dumps({"schemaVersion": 1, "snapshotRevision": 1, "targets": [{"tenantId": "t1", "database": config["dbname"], "enabled": True}]}),
            encoding="utf-8",
        )
        for schema in schemas:
            await conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            scoped = make_conninfo(database_url, options=f"-c search_path={schema}")
            control = await open_control(scoped, initialize=True)
            states.append({"url": scoped, "state_id": control.state_id, "schema": schema, "registry": str(registry)})
            await control.aclose()
        assert states[0]["state_id"] != states[1]["state_id"]
        yield states
    finally:
        # Preserve all schema/records for inspection. Never overwrite/drop another fixture.
        await conn.close()


def child_env(state):
    import liwan_ai_service
    import tests

    return {
        **os.environ,
        "AI_TEST_DATABASE_URL": state["url"],
        "LIWAN_TENANCY_MODE": "shared",
        "LIWAN_TENANT_REGISTRY_PATH": state["registry"],
        "AI_TEST_SOURCE_DIR": str(Path(__file__).resolve().parents[1] / "src/liwan_ai_service"),
        "PYTHONPATH": os.pathsep.join((str(Path(liwan_ai_service.__file__).parent.parent), str(Path(tests.__file__).parent.parent))),
    }


async def child(state, mode, generation):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-B", "-c", CHILD, mode, generation, env=child_env(state), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await asyncio.wait_for(process.communicate(), 20)
    assert process.returncode == 0, f"AI child exit {process.returncode}; stderr bytes {len(err)}"
    return json.loads(out)


async def server(state, generation):
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-B", "-c", CHILD, "serve", generation, env=child_env(state), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        line = await asyncio.wait_for(process.stdout.readline(), 15)
        ready = json.loads(line)
    except Exception:
        if process.returncode is None:
            process.terminate()
        await process.wait()
        raise RuntimeError("AI fixture did not report startup identity") from None
    return process, f"http://127.0.0.1:{ready['port']}"


async def stop(process):
    if process.returncode is None:
        process.terminate()
    await asyncio.wait_for(process.wait(), 10)


async def test_real_process_restart_preserves_generation_drain_and_database_identity(scratch_states):
    state = scratch_states[0]
    before = await child(state, "drain", "restart-old")
    restarted = await child(state, "ready", "restart-old")
    new = await child(state, "ready", "restart-new")
    for observed in (before, restarted):
        assert observed["evidence"]["state_id"] == state["state_id"]
        assert observed["evidence"]["generation_id"] == "restart-old"
        assert observed["evidence"]["drained"] and not observed["evidence"]["accepting"]
        assert observed["start_status"] == 503
    assert new["evidence"]["state_id"] == state["state_id"]
    assert new["evidence"]["generation_id"] == "restart-new"
    assert new["evidence"]["accepting"] and new["start_status"] == 200
    print(
        json.dumps(
            {
                "proof": "postgres-generation-restart",
                "schemas": [s["schema"] for s in scratch_states],
                "state_ids": [s["state_id"] for s in scratch_states],
                "old_restart_status": 503,
                "new_status": 200,
            }
        )
    )
