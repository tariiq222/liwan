import asyncio
from datetime import timedelta

import pytest

from nasq_ai_service.store import MemoryRunStore


async def test_memory_store_round_trip_and_ownership():
    store = MemoryRunStore()
    record = await store.create("t1", "42")
    assert record.run_id.startswith("r_") and record.status == "running"
    assert (await store.get(record.run_id)).tenant == "t1"
    await store.finish(record.run_id, "waiting_tool", record.lease)
    assert (await store.get(record.run_id)).status == "waiting_tool"
    assert await store.get("r_missing") is None


async def test_finish_only_overwrites_a_running_run():
    store = MemoryRunStore()
    record = await store.create("t1", "42")
    await store.finish(record.run_id, "done", record.lease)
    await store.finish(record.run_id, "failed", record.lease)  # a late writer must not clobber the settled status
    assert (await store.get(record.run_id)).status == "done"


async def test_acquire_moves_an_allowed_status_to_running_exactly_once():
    store = MemoryRunStore()
    record = await store.create("t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease)
    results = await asyncio.gather(*(store.acquire(record.run_id, ("waiting_tool", "waiting_user"), stale_after_seconds=60) for _ in range(5)))
    assert sorted(result is None for result in results) == [False] + [True] * 4
    assert (await store.get(record.run_id)).status == "running"
    assert await store.acquire("r_missing", ("done",), stale_after_seconds=60) is None


async def test_memory_store_deletes_by_last_update_not_creation():
    store = MemoryRunStore()
    old = await store.create("t1", "42")
    store.records[old.run_id].updated_at -= timedelta(days=40)
    touched = await store.create("t1", "42")
    store.records[touched.run_id].created_at -= timedelta(days=40)  # created long ago, active today
    assert await store.delete_older_than(30) == [old.run_id]
    assert await store.get(touched.run_id) is not None


async def test_retention_window_is_at_least_one_day():
    with pytest.raises(ValueError, match="at least 1 day"):
        await MemoryRunStore().delete_older_than(0)


STALE = 60


async def test_a_finish_with_an_old_lease_never_overwrites_a_newer_acquire():
    store = MemoryRunStore()
    record = await store.create("t1", "42")
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
    record = await store.create("t1", "42")
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
    record = await store.create("t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease, "c_2")
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_1") is None
    assert (await store.get(record.run_id)).status == "waiting_tool"
    assert await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_2")


async def test_the_pending_call_id_is_cleared_when_the_run_settles_without_waiting():
    store = MemoryRunStore()
    record = await store.create("t1", "42")
    await store.finish(record.run_id, "waiting_tool", record.lease, "c_1")
    assert (await store.get(record.run_id)).pending_call_id == "c_1"
    lease = await store.acquire(record.run_id, ("waiting_tool",), stale_after_seconds=STALE, pending_call_id="c_1")
    await store.finish(record.run_id, "done", lease)
    assert (await store.get(record.run_id)).pending_call_id is None
