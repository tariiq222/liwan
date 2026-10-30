import asyncio
from datetime import timedelta

import pytest

from tests.fakes import new_id
from liwan_ai_service.store import MemoryRunStore


async def test_memory_store_round_trip_and_ownership():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    assert record.run_id.startswith("r_") and record.status == "running"
    assert (await store.get(record.run_id)).tenant == "t1"
    await store.finish(record.run_id, "waiting_tool", record.lease)
    assert (await store.get(record.run_id)).status == "waiting_tool"
    assert await store.get("r_missing") is None


async def test_finish_only_overwrites_a_running_run():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    await store.finish(record.run_id, "done", record.lease)
    await store.finish(record.run_id, "failed", record.lease)  # a late writer must not clobber the settled status
    assert (await store.get(record.run_id)).status == "done"


async def test_acquire_moves_an_allowed_status_to_running_exactly_once():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease)
    results = await asyncio.gather(*(store.acquire(record.run_id, ("waiting_tool", "waiting_user"), stale_after_seconds=60) for _ in range(5)))
    assert sorted(result is None for result in results) == [False] + [True] * 4
    assert (await store.get(record.run_id)).status == "running"
    assert await store.acquire("r_missing", ("done",), stale_after_seconds=60) is None


async def test_memory_store_deletes_by_last_update_not_creation():
    store = MemoryRunStore()
    old = await store.create(new_id(), "t1", "42")
    store.records[old.run_id].updated_at -= timedelta(days=40)
    touched = await store.create(new_id(), "t1", "42")
    store.records[touched.run_id].created_at -= timedelta(days=40)  # created long ago, active today
    assert await store.delete_older_than(30) == [old.run_id]
    assert await store.get(touched.run_id) is not None


async def test_retention_window_is_at_least_one_day():
    with pytest.raises(ValueError, match="at least 1 day"):
        await MemoryRunStore().delete_older_than(0)


STALE = 60


async def test_a_finish_with_an_old_lease_never_overwrites_a_newer_acquire():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    old_lease = record.lease
    await store.finish(record.run_id, "waiting_tool", old_lease, "c_1")
    new_lease = await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_1")
    assert new_lease and new_lease != old_lease
    await store.finish(record.run_id, "failed", old_lease)  # the generator of the previous turn, finishing late
    assert (await store.get(record.run_id)).status == "running"
    await store.finish(record.run_id, "done", new_lease)
    assert (await store.get(record.run_id)).status == "done"


async def test_a_stale_running_run_can_be_acquired_but_a_fresh_one_cannot():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    first_lease = record.lease
    assert await store.acquire(record.run_id, ("done",), stale_after_seconds=STALE) is None
    store.records[record.run_id].updated_at -= timedelta(seconds=STALE + 5)
    lease = await store.acquire(record.run_id, ("done",), stale_after_seconds=STALE)
    assert lease and lease != first_lease
    assert await store.acquire(record.run_id, ("done",), stale_after_seconds=STALE) is None  # acquiring refreshed it
    await store.finish(record.run_id, "failed", first_lease)  # the crashed turn's late finish
    assert (await store.get(record.run_id)).status == "running"


async def test_acquire_for_a_resume_compares_the_pending_call_id_atomically():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease, "c_2")
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_1") is None
    assert (await store.get(record.run_id)).status == "waiting_tool"
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_2")


async def test_the_pending_call_id_is_cleared_when_the_run_settles_without_waiting():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease, "c_1")
    assert (await store.get(record.run_id)).pending_call_id == "c_1"
    lease = await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_1")
    await store.finish(record.run_id, "done", lease)
    assert (await store.get(record.run_id)).pending_call_id is None


async def test_list_for_owner_returns_only_that_tenant_and_user_newest_first_up_to_the_limit():
    store = MemoryRunStore()
    first = await store.create(new_id(), "t1", "42", "first")
    second = await store.create(new_id(), "t1", "42", "second")
    await store.create(new_id(), "t1", "7", "other user")
    await store.create(new_id(), "t2", "42", "other tenant")
    store.records[first.run_id].updated_at += timedelta(seconds=5)
    assert [r.run_id for r in await store.list_for_owner("t1", "42")] == [first.run_id, second.run_id]
    assert [r.run_id for r in await store.list_for_owner("t1", "42", limit=1)] == [first.run_id]
    assert [r.title for r in await store.list_for_owner("t1", "7")] == ["other user"]
    assert await store.list_for_owner("t3", "42") == []


async def test_a_generated_title_never_overwrites_a_users_title():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42", "provisional")
    assert await store.set_generated_title(record.run_id, "generated") is True
    assert (await store.get(record.run_id)).title == "generated" and not (await store.get(record.run_id)).title_locked
    await store.update_meta(record.run_id, title="mine")
    assert await store.set_generated_title(record.run_id, "again") is False
    kept = await store.get(record.run_id)
    assert kept.title == "mine" and kept.title_locked
    assert await store.set_generated_title("r_missing", "x") is False


async def test_update_meta_renames_locks_and_archives_without_touching_the_run():
    store = MemoryRunStore()
    record = await store.create(new_id(), "t1", "42", "provisional")
    before = (record.status, record.lease, record.updated_at, record.pending_call_id)
    renamed = await store.update_meta(record.run_id, title="اسمي")
    assert (renamed.title, renamed.title_locked, renamed.archived_at) == ("اسمي", True, None)
    archived = await store.update_meta(record.run_id, archived=True)
    assert archived.title == "اسمي" and archived.archived_at is not None  # archiving alone leaves the title as it was
    stamp = archived.archived_at
    assert (await store.update_meta(record.run_id, archived=True)).archived_at == stamp  # archiving again keeps the first moment
    assert (await store.update_meta(record.run_id, archived=False)).archived_at is None
    assert (await store.update_meta(record.run_id, title="ثان", archived=True)).title == "ثان"
    after = await store.get(record.run_id)
    assert (after.status, after.lease, after.updated_at, after.pending_call_id) == before
    assert await store.update_meta("r_missing", title="x") is None


async def test_the_owner_list_splits_active_and_archived_runs():
    store = MemoryRunStore()
    active = await store.create(new_id(), "t1", "42", "active")
    gone = await store.create(new_id(), "t1", "42", "archived")
    await store.create(new_id(), "t1", "7", "other user archived")
    await store.update_meta(gone.run_id, archived=True)
    assert [r.run_id for r in await store.list_for_owner("t1", "42")] == [active.run_id]
    assert [r.run_id for r in await store.list_for_owner("t1", "42", archived=True)] == [gone.run_id]
    assert await store.list_for_owner("t1", "42", limit=1, archived=True) == [await store.get(gone.run_id)]
    await store.update_meta(gone.run_id, archived=False)
    assert await store.list_for_owner("t1", "42", archived=True) == []


async def test_retention_deletes_archived_runs_by_last_update_too():
    store = MemoryRunStore()
    old = await store.create(new_id(), "t1", "42")
    recent = await store.create(new_id(), "t1", "42")
    for record in (old, recent):
        await store.update_meta(record.run_id, archived=True)
    store.records[old.run_id].updated_at -= timedelta(days=40)
    assert await store.delete_older_than(30) == [old.run_id]
    assert await store.get(recent.run_id) is not None


async def test_create_uses_the_given_id_and_refuses_a_taken_one():
    store = MemoryRunStore()
    run_id = "r_" + "0f" * 12
    record = await store.create(run_id, "t1", "42", "first")
    assert record is not None and record.run_id == run_id
    assert await store.create(run_id, "t2", "7", "second") is None
    assert (await store.get(run_id)).title == "first"
