"""Opt-in live proof in two new preserved schemas of a local AI scratch database."""

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
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from liwan_ai_service.store import open_state

pytestmark = pytest.mark.skipif(os.environ.get("AI_DURABLE_RELEASE_TEST") != "1", reason="explicit local scratch acceptance only")
TOKEN = "synthetic-durable-test-token-" * 2
ADMIN = {"x-liwan-service-token": TOKEN}
CHILD = """
import asyncio, importlib.util, json, os, sys
from pathlib import Path
import liwan_ai_service
import liwan_ai_service.contracts
for name in ('settings', 'store', 'service'):
    path = Path(os.environ['AI_TEST_SOURCE_DIR']) / (name+'.py')
    spec = importlib.util.spec_from_file_location('liwan_ai_service.'+name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    setattr(liwan_ai_service, name, module)
    spec.loader.exec_module(module)
import httpx
from liwan_ai_service.service import create_app
from liwan_ai_service.settings import Settings
from liwan_ai_service.store import open_state
from tests.fakes import ScriptedChatModel, ai_text
from tests.test_service import BODY, HEADERS, fresh
async def main():
    token = 'synthetic-durable-test-token-' * 2
    admin = {'x-liwan-service-token':token}
    store, checkpoints, close = await open_state(os.environ['AI_TEST_DATABASE_URL'])
    settings = Settings.from_env({'AI_PROVIDER':'ollama', 'AI_MODEL':'scripted',
        'AI_DATABASE_URL':os.environ['AI_TEST_DATABASE_URL'], 'AI_SERVICE_TOKEN':token,
        'AI_GENERATION_ID':sys.argv[2]})
    app = create_app(ScriptedChatModel([ai_text('done')], title_responses=[ai_text('title')]), store, checkpoints, settings)
    try:
        if sys.argv[1] == 'serve':
            import uvicorn
            server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=0, log_level='error', access_log=False))
            task = asyncio.create_task(server.serve())
            while not server.started:
                if task.done(): await task
                await asyncio.sleep(0.01)
            print(json.dumps({'port':server.servers[0].sockets[0].getsockname()[1], 'state_id':store.state_id}), flush=True)
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
        await close()
asyncio.run(main())
"""


@pytest.fixture
async def scratch_states():
    database_url = os.environ["AI_TEST_DATABASE_URL"]
    config = conninfo_to_dict(database_url)
    if not config.get("dbname", "").startswith("liwan_scratch_") or config.get("host") not in ("127.0.0.1", "localhost", "::1"):
        pytest.fail("live AI proof requires an explicit local liwan_scratch_ database")
    conn = await psycopg.AsyncConnection.connect(database_url, autocommit=True)
    suffix = uuid4().hex[:12]
    schemas = [f"release_durable_1016_{suffix}_{name}" for name in ("a", "b")]
    states = []
    try:
        for schema in schemas:
            await conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            scoped = make_conninfo(database_url, options=f"-c search_path={schema}")
            store, _, close = await open_state(scoped, initialize=True)
            states.append({"url": scoped, "state_id": store.state_id, "schema": schema})
            await close()
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


async def test_actual_different_database_identity_is_refused_before_migration(scratch_states, tmp_path):
    from deploy.releases.ai_maintenance import AiMaintenanceCoordinator, ReviewedAiMigration
    from deploy.releases.manifest import manifest_digest
    from deploy.releases.state import ReleaseConflict, ReleaseState, atomic_json
    from deploy.releases.test_ai_maintenance import manifest

    old_state, wrong_state = scratch_states
    processes = []
    try:
        old, old_url = await server(old_state, "identity-old")
        processes.append(old)
        wrong, wrong_url = await server(wrong_state, "identity-new")
        processes.append(wrong)
        state = ReleaseState(tmp_path.resolve() / "release")
        state.register(
            {"tenantId": "a", "database": "liwan_scratch_a", "filestore": "liwan_scratch_a", "registryRevision": 1},
            {
                "schemaVersion": 1,
                "tenantId": "a",
                "identityRevision": 1,
                "routeRevision": 1,
                "releaseId": "r1",
                "poolId": "blue",
                "fence": 1,
                "state": "serving",
            },
        )
        atomic_json(
            state.routes / "pools.json",
            {
                "schemaVersion": 1,
                "pools": {
                    "blue": {
                        "poolId": "blue",
                        "releaseId": "r1",
                        "odooUrl": "http://odoo.test",
                        "webUrl": "http://web.test",
                        "wsUrl": "http://ws.test",
                        "aiUrl": old_url,
                        "aiStateVersion": "1",
                    }
                },
            },
        )
        token_file = tmp_path / "token"
        token_file.write_text(TOKEN)
        token_file.chmod(0o600)
        state_id = old_state["state_id"]
        config = {
            "sharedStateId": state_id,
            "tenantIds": ["a"],
            "tokenFile": str(token_file),
            "timeoutSeconds": 2,
            "oldServices": [{"id": "identity-old", "url": old_url, "sharedStateId": state_id, "aiStateVersion": "1"}],
            "newServices": [{"id": "identity-new", "url": wrong_url, "sharedStateId": state_id, "aiStateVersion": "1"}],
            "poolTargets": {"blue": "identity-new"},
        }
        migrations = []
        migration = ReviewedAiMigration(state_id, "1", "1", "review", "a" * 64, lambda context: migrations.append(context))
        release = manifest()
        request = {
            "requestId": "wrong-identity",
            "manifestDigest": manifest_digest(release),
            "approvedMode": "service_maintenance",
            "tenantIds": ["a"],
            "expectedRoutes": {"a": 1},
        }
        with pytest.raises(ReleaseConflict, match="ai_service_observation_failed"):
            AiMaintenanceCoordinator(state, config, migration).apply(request, release)
        assert migrations == [] and not (state.routes / "ai.maintenance").exists()
        async with httpx.AsyncClient() as client:
            ready = (await client.get(old_url + "/internal/release/readiness", headers=ADMIN)).json()
            assert ready["accepting"] and ready["state_id"] == state_id
        print(
            json.dumps(
                {
                    "proof": "actual-state-identity-negative",
                    "schemas": [s["schema"] for s in scratch_states],
                    "state_ids": [s["state_id"] for s in scratch_states],
                    "migration_calls": 0,
                    "old_still_accepting": True,
                }
            )
        )
    finally:
        for process in processes:
            await stop(process)
