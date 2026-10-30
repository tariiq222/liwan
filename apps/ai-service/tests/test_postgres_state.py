"""Runs only with AI_TEST_DATABASE_URL: proves state survives a new process (Review Focus 5) and the store's atomic parts."""
import asyncio
import os

import pytest
from langgraph.types import Command

from tests.fakes import IDENTITY, ScriptedChatModel, ai_text, ai_tool_call, new_id
from tests.test_contracts import READ_TOOL
from liwan_ai_service.contracts import RunRequest, ToolResult
from liwan_ai_service.graph import build_graph, initial_state, run_config
from liwan_ai_service.store import open_state

pytestmark = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")

REQUEST = {
    "tenant": "t1", "user_ref": "42", "locale": "ar", "message": "؟", "context": None,
    "tools": [READ_TOOL], "limits": {"max_steps": 6, "max_tool_calls": 2, "timeout_seconds": 60},
    "new_run_id": "r_" + "ab" * 12,
}


def url():
    return os.environ["AI_TEST_DATABASE_URL"]


async def age(store, run_id, days):
    async with store.pool.connection() as conn:
        await conn.execute("UPDATE ai_runs SET updated_at = now() - make_interval(days => %s) WHERE run_id = %s", (days, run_id))


async def checkpoint_rows(store, run_id):
    async with store.pool.connection() as conn:
        total = 0
        for table in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
            total += (await (await conn.execute(f"SELECT count(*) FROM {table} WHERE thread_id = %s", (run_id,))).fetchone())[0]  # noqa: S608 - constant tables
        return total


async def test_interrupted_run_resumes_through_a_fresh_checkpointer():
    request = RunRequest.model_validate(REQUEST)
    store, checkpointer, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t1", "42")
        graph = build_graph(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1")]), checkpointer, IDENTITY)
        await graph.ainvoke(initial_state(request), run_config(record.run_id, 6))
    finally:
        await aclose()
    store2, checkpointer2, aclose2 = await open_state(url())
    try:
        graph2 = build_graph(ScriptedChatModel([ai_text("تم")]), checkpointer2, IDENTITY)
        resume = Command(resume=ToolResult(ok=True, data={"items": [], "total": 0}).model_dump())
        final = await graph2.ainvoke(resume, run_config(record.run_id, 6))
        assert final["outcome"] == "answer"
        assert (await store2.get(record.run_id)).tenant == "t1"
        await age(store2, record.run_id, 40)
        assert await store2.delete_older_than(30) == [record.run_id]
    finally:
        await aclose2()


async def test_acquire_is_atomic_and_finish_only_overwrites_running():
    store, _checkpointer, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t1", "42")
        await store.finish(record.run_id, "waiting_tool", record.lease)
        results = await asyncio.gather(*(store.acquire(record.run_id, ("waiting_tool", "waiting_user"), stale_after_seconds=60) for _ in range(6)))
        leases = [result for result in results if result]
        assert len(leases) == 1
        assert (await store.get(record.run_id)).status == "running"
        await store.finish(record.run_id, "done", leases[0])
        await store.finish(record.run_id, "failed", leases[0])
        assert (await store.get(record.run_id)).status == "done"
        assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=60) is None
    finally:
        await aclose()


async def test_retention_deletes_stale_runs_with_their_checkpoints_and_keeps_recent_ones():
    request = RunRequest.model_validate(REQUEST)
    store, checkpointer, aclose = await open_state(url())
    try:
        stale = await store.create(new_id(), "t1", "42")
        waiting = await store.create(new_id(), "t1", "42")
        finished = await store.create(new_id(), "t1", "42")
        for record in (stale, waiting):
            graph = build_graph(ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1")]), checkpointer, IDENTITY)
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
    finally:
        await aclose()


async def test_the_cleanup_job_runs_with_only_the_database_and_the_window(monkeypatch, capsys):
    from liwan_ai_service import cleanup

    store, _checkpointer, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t1", "42")
        await store.finish(record.run_id, "done", record.lease)
        await age(store, record.run_id, 40)
        for name in ("AI_PROVIDER", "AI_MODEL", "AI_API_KEY"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("AI_DATABASE_URL", url())
        monkeypatch.setenv("AI_RUN_RETENTION_DAYS", "30")
        assert await cleanup.main() == 0
        assert "deleted" in capsys.readouterr().out and await store.get(record.run_id) is None
    finally:
        await aclose()


async def test_the_lease_the_stale_window_and_the_pending_call_are_atomic_in_postgres():
    store, _checkpointer, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t1", "42")
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
    finally:
        await aclose()


async def test_failed_runtime_validation_closes_the_pool_without_checkpoint_setup(monkeypatch):
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    closed = []
    real_close = AsyncConnectionPool.close

    async def recording_close(self, *args, **kwargs):
        closed.append(True)
        await real_close(self, *args, **kwargs)

    async def broken_validation(conn, checkpoint_version):
        raise RuntimeError("incompatible state")

    async def forbidden_setup(self):
        pytest.fail("runtime must not execute checkpoint setup")

    monkeypatch.setattr(AsyncConnectionPool, "close", recording_close)
    monkeypatch.setattr("liwan_ai_service.store._validate_state", broken_validation)
    monkeypatch.setattr(AsyncPostgresSaver, "setup", forbidden_setup)
    with pytest.raises(RuntimeError, match="incompatible state"):
        await open_state(url())
    assert closed == [True]


async def test_concurrent_claims_give_one_winner_and_a_stale_executing_run_is_only_taken_over_by_a_new_message_in_postgres():
    store, _checkpointer, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t1", "42")
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
    finally:
        await aclose()


async def test_list_for_owner_is_isolated_by_tenant_and_user_and_ordered_by_update():
    store, _, aclose = await open_state(url())
    try:
        mine = await store.create(new_id(), "t_hist", "42", "mine")
        newer = await store.create(new_id(), "t_hist", "42", "newer")
        await store.create(new_id(), "t_hist", "7", "other user")
        await store.create(new_id(), "t_hist_other", "42", "other tenant")
        await age(store, mine.run_id, 1)
        listed = await store.list_for_owner("t_hist", "42")
        assert [(r.run_id, r.title) for r in listed] == [(newer.run_id, "newer"), (mine.run_id, "mine")]
        assert len(await store.list_for_owner("t_hist", "42", limit=1)) == 1
        assert await store.list_for_owner("t_hist", "nobody") == []
    finally:
        async with store.pool.connection() as conn:
            await conn.execute("DELETE FROM ai_runs WHERE tenant IN ('t_hist', 't_hist_other')")
        await aclose()


async def test_generated_titles_respect_a_users_rename_and_archive_leaves_the_run_alone():
    store, _, aclose = await open_state(url())
    try:
        record = await store.create(new_id(), "t_meta", "42", "provisional")
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
    finally:
        async with store.pool.connection() as conn:
            await conn.execute("DELETE FROM ai_runs WHERE tenant = 't_meta'")
        await aclose()


async def test_the_owner_list_splits_active_and_archived_runs_and_retention_covers_both():
    store, _, aclose = await open_state(url())
    try:
        active = await store.create(new_id(), "t_arch", "42", "active")
        gone = await store.create(new_id(), "t_arch", "42", "archived")
        stale = await store.create(new_id(), "t_arch", "42", "stale archived")
        await store.create(new_id(), "t_arch", "7", "other user")
        for record in (gone, stale):
            await store.update_meta(record.run_id, archived=True)
        assert [r.run_id for r in await store.list_for_owner("t_arch", "42")] == [active.run_id]
        assert {r.run_id for r in await store.list_for_owner("t_arch", "42", archived=True)} == {gone.run_id, stale.run_id}
        assert len(await store.list_for_owner("t_arch", "42", limit=1, archived=True)) == 1
        await age(store, stale.run_id, 40)
        assert await store.delete_older_than(30) == [stale.run_id]
        assert await store.get(stale.run_id) is None and await store.get(gone.run_id) is not None
    finally:
        async with store.pool.connection() as conn:
            await conn.execute("DELETE FROM ai_runs WHERE tenant = 't_arch'")
        await aclose()


async def test_create_uses_the_given_id_and_refuses_a_taken_one():
    store, _checkpointer, aclose = await open_state(url())
    try:
        run_id = new_id()
        record = await store.create(run_id, "t_dup", "42", "first")
        assert record is not None and record.run_id == run_id
        assert await store.create(run_id, "t_dup2", "7", "second") is None
        stored = await store.get(run_id)
        assert (stored.tenant, stored.title) == ("t_dup", "first")
    finally:
        await aclose()
