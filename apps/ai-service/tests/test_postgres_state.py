"""Runs only with AI_TEST_DATABASE_URL: proves tenant state survives a new process and the store's atomic parts."""
import asyncio
import os
from dataclasses import dataclass
from uuid import uuid4

import psycopg
import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg_pool import AsyncConnectionPool

from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.control import open_control
from liwan_ai_service.graph import initial_state, run_config
from liwan_ai_service.store import PostgresRunStore, StateCompatibilityError, initialize_tenant, validate_tenant
from tests.fakes import PLATFORM_POLICY, BoundGraph, ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_contracts import PMO_AGENT, READ_TOOL

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")

REQUEST = {
    "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "؟", "context": None,
    "tools": [READ_TOOL], "agents": [PMO_AGENT], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60}, "policy": PLATFORM_POLICY,
    "new_run_id": "r_" + "ab" * 12,
}
CHECKPOINT_TABLES = ("checkpoints", "checkpoint_blobs", "checkpoint_writes")
TENANT_TABLES = ("ai_runs", *CHECKPOINT_TABLES, "checkpoint_migrations", "ai_tenant_config", "ai_tenant_schema")


def base_url():
    return os.environ["AI_TEST_DATABASE_URL"]


def schema_conninfo(schema: str) -> str:
    return make_conninfo(base_url(), options=f"-c search_path={schema}")


async def create_schema(name: str) -> None:
    conn = await psycopg.AsyncConnection.connect(base_url(), autocommit=True)
    try:
        await conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    finally:
        await conn.close()


async def drop_schema(name: str) -> None:
    conn = await psycopg.AsyncConnection.connect(base_url(), autocommit=True)
    try:
        await conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))
    finally:
        await conn.close()


async def open_tenant(conninfo: str):
    pool = AsyncConnectionPool(conninfo, min_size=1, max_size=5, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()
    return PostgresRunStore(pool), AsyncPostgresSaver(pool), pool


async def age(store, run_id, days):
    async with store.pool.connection() as conn:
        await conn.execute("UPDATE ai_runs SET updated_at = now() - make_interval(days => %s) WHERE run_id = %s", (days, run_id))


async def checkpoint_rows(store, run_id):
    async with store.pool.connection() as conn:
        total = 0
        for table in CHECKPOINT_TABLES:
            total += (await (await conn.execute(f"SELECT count(*) FROM {table} WHERE thread_id = %s", (run_id,))).fetchone())[0]  # noqa: S608 - constant tables
        return total


@dataclass
class Tenant:
    store: PostgresRunStore
    checkpointer: AsyncPostgresSaver
    conninfo: str
    run_ids: list[str]


@pytest.fixture
async def tenant():
    """A bootstrapped tenant schema, opened as the runtime opens it, cleaned of this test's runs afterwards."""
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    conninfo = schema_conninfo(schema)
    await initialize_tenant(conninfo)
    store, checkpointer, pool = await open_tenant(conninfo)
    state = Tenant(store, checkpointer, conninfo, [])
    try:
        yield state
    finally:
        async with pool.connection() as conn, conn.transaction():
            for table in CHECKPOINT_TABLES:
                await conn.execute(f"DELETE FROM {table} WHERE thread_id = ANY(%s)", (state.run_ids,))
            await conn.execute("DELETE FROM ai_runs WHERE run_id = ANY(%s)", (state.run_ids,))
        await pool.close()
        await drop_schema(schema)


async def create(tenant: Tenant, user_ref: str, title=None):
    record = await tenant.store.create(new_id(), user_ref, title)
    tenant.run_ids.append(record.run_id)
    return record


async def test_initialize_control_creates_only_control_tables():
    schema = f"control_{uuid4().hex[:12]}"
    await create_schema(schema)
    control = await open_control(schema_conninfo(schema), initialize=True)
    try:
        async with await psycopg.AsyncConnection.connect(base_url(), autocommit=True) as conn:
            rows = await (await conn.execute(
                "SELECT to_regclass(%s), to_regclass(%s), to_regclass(%s), to_regclass(%s)",
                (f"{schema}.ai_state_schema", f"{schema}.ai_generations", f"{schema}.ai_runs", f"{schema}.checkpoints"),
            )).fetchone()
        assert rows[0] == f"{schema}.ai_state_schema" and rows[1] == f"{schema}.ai_generations"
        assert rows[2] is None and rows[3] is None
        assert control.state_id.startswith("state_")
    finally:
        await control.aclose()
        await drop_schema(schema)


async def test_initialize_tenant_creates_tables_in_liwan_ai_schema():
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    try:
        await initialize_tenant(schema_conninfo(schema))
        async with await psycopg.AsyncConnection.connect(base_url(), autocommit=True) as conn:
            rows = await (await conn.execute(
                "SELECT " + ", ".join(["to_regclass(%s)"] * len(TENANT_TABLES)),
                tuple(f"{schema}.{table}" for table in TENANT_TABLES),
            )).fetchone()
            leaked = await (await conn.execute(
                "SELECT " + ", ".join(["to_regclass(%s)"] * len(TENANT_TABLES)),
                tuple(f"public.{table}" for table in TENANT_TABLES),
            )).fetchone()
        assert list(rows) == [f"{schema}.{table}" for table in TENANT_TABLES]
        assert not any(leaked)
    finally:
        await drop_schema(schema)


async def test_initialize_tenant_is_idempotent():
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    conninfo = schema_conninfo(schema)
    checkpoint_version = len(AsyncPostgresSaver.MIGRATIONS) - 1
    try:
        await initialize_tenant(conninfo)
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
            rows = await (await conn.execute("SELECT state_version, checkpoint_version FROM ai_tenant_schema")).fetchall()
            migrations = await (await conn.execute("SELECT max(v) FROM checkpoint_migrations")).fetchone()
        assert rows == [("1", checkpoint_version)]
        assert migrations == (checkpoint_version,)
    finally:
        await drop_schema(schema)


SCHEMA_CATALOG = (
    "SELECT c.oid, c.xmin::text, array(SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 ORDER BY a.attnum),"
    " array(SELECT k.oid FROM pg_constraint k WHERE k.conrelid = c.oid ORDER BY k.oid)"
    " FROM pg_class c WHERE c.relnamespace = %s::regnamespace ORDER BY c.oid"
)


async def test_initialize_tenant_runs_no_ddl_on_a_finished_schema():
    """A second bootstrap only validates: every relation, column and constraint keeps its catalog row untouched."""
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    conninfo = schema_conninfo(schema)
    try:
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(base_url(), autocommit=True) as conn:
            before = await (await conn.execute(SCHEMA_CATALOG, (schema,))).fetchall()
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(base_url(), autocommit=True) as conn:
            after = await (await conn.execute(SCHEMA_CATALOG, (schema,))).fetchall()
        assert before and after == before
    finally:
        await drop_schema(schema)


async def test_initialize_tenant_completes_a_bootstrap_interrupted_before_its_marker():
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    conninfo = schema_conninfo(schema)
    try:
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute("DROP TABLE ai_tenant_schema")
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await validate_tenant(conn, len(AsyncPostgresSaver.MIGRATIONS) - 1)
    finally:
        await drop_schema(schema)


async def test_validate_tenant_rejects_missing_schema():
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    try:
        async with await psycopg.AsyncConnection.connect(schema_conninfo(schema), autocommit=True) as conn:
            with pytest.raises(StateCompatibilityError, match="ai_state_uninitialized"):
                await validate_tenant(conn, len(AsyncPostgresSaver.MIGRATIONS) - 1)
    finally:
        await drop_schema(schema)


async def test_interrupted_run_resumes_through_a_fresh_checkpointer(tenant):
    request = RunRequest.model_validate(REQUEST)
    record = await create(tenant, "42")
    graph = BoundGraph(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1")]), tenant.checkpointer)
    await graph.ainvoke(initial_state(request), run_config(record.run_id, 6))

    store2, checkpointer2, pool2 = await open_tenant(tenant.conninfo)
    try:
        graph2 = BoundGraph(ScriptedChatModel([ai_text("تم")]), checkpointer2)
        resume = Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump())
        final = await graph2.ainvoke(resume, run_config(record.run_id, 6))
        assert final["outcome"] == "answer"
        assert (await store2.get(record.run_id)).user_ref == "42"
        await age(store2, record.run_id, 40)
        assert await store2.delete_older_than(30) == [record.run_id]
    finally:
        await pool2.close()


async def test_acquire_is_atomic_and_finish_only_overwrites_running(tenant):
    record = await create(tenant, "42")
    store = tenant.store
    await store.finish(record.run_id, "waiting_tool", record.lease)
    results = await asyncio.gather(*(store.acquire(record.run_id, ("waiting_tool", "waiting_user"), stale_after_seconds=60) for _ in range(6)))
    leases = [result for result in results if result]
    assert len(leases) == 1
    assert (await store.get(record.run_id)).status == "running"
    await store.finish(record.run_id, "done", leases[0])
    await store.finish(record.run_id, "failed", leases[0])
    assert (await store.get(record.run_id)).status == "done"
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=60) is None


async def test_retention_deletes_stale_runs_with_their_checkpoints_and_keeps_recent_ones(tenant):
    store = tenant.store
    request = RunRequest.model_validate(REQUEST)
    stale = await create(tenant, "42")
    waiting = await create(tenant, "42")
    finished = await create(tenant, "42")
    for record in (stale, waiting):
        graph = BoundGraph(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1")]), tenant.checkpointer)
        await graph.ainvoke(initial_state(request), run_config(record.run_id, 6))
        await store.finish(record.run_id, "waiting_tool", record.lease)
    await store.finish(finished.run_id, "done", finished.lease)
    assert await checkpoint_rows(store, stale.run_id) > 0
    await age(store, stale.run_id, 40)
    await age(store, finished.run_id, 5)
    assert await store.delete_older_than(30) == [stale.run_id]
    assert await store.get(stale.run_id) is None and await checkpoint_rows(store, stale.run_id) == 0
    assert await store.get(waiting.run_id) is not None and await checkpoint_rows(store, waiting.run_id) > 0
    assert await store.get(finished.run_id) is not None
    with pytest.raises(ValueError, match="at least 1 day"):
        await store.delete_older_than(0)


async def test_the_lease_the_stale_window_and_the_pending_call_are_atomic_in_postgres(tenant):
    store = tenant.store
    record = await create(tenant, "42")
    assert await store.acquire(record.run_id, ("done",), stale_after_seconds=60) is None  # fresh running
    async with store.pool.connection() as conn:
        await conn.execute("UPDATE ai_runs SET updated_at = now() - interval '2 minutes' WHERE run_id = %s", (record.run_id,))
    lease = await store.acquire(record.run_id, ("done",), stale_after_seconds=60)
    assert lease and lease != record.lease
    await store.finish(record.run_id, "failed", record.lease)  # the crashed turn, finishing late
    assert (await store.get(record.run_id)).status == "running"
    await store.finish(record.run_id, "waiting_tool", lease, "c_2")
    assert (await store.get(record.run_id)).pending_call_id == "c_2"
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=60, pending_call_id="c_1") is None
    lease = await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=60, pending_call_id="c_2")
    assert lease
    await store.finish(record.run_id, "done", lease)
    assert (await store.get(record.run_id)).pending_call_id is None


async def test_concurrent_claims_give_one_winner_and_a_stale_executing_run_is_only_taken_over_by_a_new_message_in_postgres(tenant):
    store = tenant.store
    record = await create(tenant, "42")
    await store.finish(record.run_id, "waiting_user", record.lease, "c_1")
    claim = dict(stale_after_seconds=60, pending_call_id="c_1", to_status="executing")
    assert await store.acquire(record.run_id, ("waiting_user",), **{**claim, "pending_call_id": "c_2"}) is None
    results = await asyncio.gather(*(store.acquire(record.run_id, ("waiting_user",), **claim) for _ in range(6)))
    [lease] = [result for result in results if result]
    stored = await store.get(record.run_id)
    assert stored.status == "executing" and stored.lease == lease and stored.pending_call_id == "c_1"
    waiting = ("waiting_tool", "waiting_user", "executing")
    assert await store.acquire(record.run_id, waiting, stale_after_seconds=60, pending_call_id="c_1") is not None
    await store.finish(record.run_id, "waiting_user", lease, "c_1")  # the superseded holder cannot settle it
    assert (await store.get(record.run_id)).status == "running"
    async with store.pool.connection() as conn:
        await conn.execute("UPDATE ai_runs SET status = 'executing', updated_at = now() - interval '2 minutes' WHERE run_id = %s", (record.run_id,))
    assert await store.acquire(record.run_id, ("done",), stale_after_seconds=60) is None  # a stale executing run is not taken by default
    assert await store.acquire(record.run_id, waiting, stale_after_seconds=60, pending_call_id="c_1") is None  # nor resumed
    assert await store.acquire(record.run_id, ("waiting_user",), **claim) is None  # nor claimed again
    assert await store.acquire(record.run_id, ("done",), stale_after_seconds=60, takeover=("running", "executing")) is not None


async def test_list_for_owner_is_isolated_by_user_and_ordered_by_update(tenant):
    store = tenant.store
    mine = await create(tenant, "42", "mine")
    newer = await create(tenant, "42", "newer")
    await create(tenant, "7", "other user")
    await age(store, mine.run_id, 1)
    listed = await store.list_for_owner("42")
    assert [(r.run_id, r.title) for r in listed] == [(newer.run_id, "newer"), (mine.run_id, "mine")]
    assert len(await store.list_for_owner("42", limit=1)) == 1
    assert await store.list_for_owner("nobody") == []


async def test_generated_titles_respect_a_users_rename_and_archive_leaves_the_run_alone(tenant):
    store = tenant.store
    record = await create(tenant, "42", "provisional")
    assert await store.set_generated_title(record.run_id, "generated") is True
    before = await store.get(record.run_id)
    assert before.title == "generated" and before.title_locked is False and before.archived_at is None
    renamed = await store.update_meta(record.run_id, title="mine")
    assert (renamed.title, renamed.title_locked) == ("mine", True)
    assert await store.set_generated_title(record.run_id, "again") is False
    archived = await store.update_meta(record.run_id, archived=True)
    assert archived.title == "mine" and archived.archived_at is not None
    assert (await store.update_meta(record.run_id, archived=True)).archived_at == archived.archived_at
    after = await store.get(record.run_id)
    assert (after.status, after.lease, after.updated_at, after.pending_call_id) == (before.status, before.lease, before.updated_at, before.pending_call_id)
    assert (await store.update_meta(record.run_id, archived=False)).archived_at is None
    assert (await store.update_meta(record.run_id, title="ثان", archived=True)).title == "ثان"
    assert await store.update_meta("r_missing", title="x") is None
    assert await store.set_generated_title("r_missing", "x") is False


async def test_the_owner_list_splits_active_and_archived_runs_and_retention_covers_both(tenant):
    store = tenant.store
    active = await create(tenant, "42", "active")
    gone = await create(tenant, "42", "archived")
    stale = await create(tenant, "42", "stale archived")
    await create(tenant, "7", "other user")
    for record in (gone, stale):
        await store.update_meta(record.run_id, archived=True)
    assert [r.run_id for r in await store.list_for_owner("42")] == [active.run_id]
    assert {r.run_id for r in await store.list_for_owner("42", archived=True)} == {gone.run_id, stale.run_id}
    assert len(await store.list_for_owner("42", limit=1, archived=True)) == 1
    await age(store, stale.run_id, 40)
    assert await store.delete_older_than(30) == [stale.run_id]
    assert await store.get(stale.run_id) is None and await store.get(gone.run_id) is not None


async def test_create_uses_the_given_id_and_refuses_a_taken_one(tenant):
    run_id = new_id()
    record = await tenant.store.create(run_id, "42", "first")
    assert record is not None and record.run_id == run_id
    tenant.run_ids.append(run_id)
    assert await tenant.store.create(run_id, "7", "second") is None
    assert (await tenant.store.get(run_id)).title == "first"


async def test_partial_tenant_state_is_incompatible_not_uninitialized():
    schema = f"tenant_{uuid4().hex[:12]}"
    await create_schema(schema)
    conninfo = schema_conninfo(schema)
    try:
        await initialize_tenant(conninfo)
        async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
            await conn.execute("DROP TABLE checkpoint_blobs")  # an incomplete restore
            with pytest.raises(StateCompatibilityError, match="ai_state_incompatible"):
                await validate_tenant(conn, len(AsyncPostgresSaver.MIGRATIONS) - 1)
    finally:
        await drop_schema(schema)
