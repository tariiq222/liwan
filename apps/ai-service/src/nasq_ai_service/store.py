"""Run ownership and status beside the LangGraph checkpoints. Memory for dev/tests, Postgres in production."""
from __future__ import annotations

import asyncio
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol


def new_run_id() -> str:
    return "r_" + secrets.token_hex(12)


ACTIVE = ("running", "executing")  # a process holds the run: only its lease settles it
EXECUTING = "executing"  # a claimed write: it may already have run, so a stale one is never re-entered by claim or resume


def is_stale(record: RunRecord, stale_after_seconds: float) -> bool:
    return record.updated_at < datetime.now(UTC) - timedelta(seconds=stale_after_seconds)


def new_lease() -> str:
    return secrets.token_hex(16)


@dataclass
class RunRecord:
    run_id: str
    tenant: str
    user_ref: str
    status: str = "running"
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    lease: str | None = None
    pending_call_id: str | None = None


class RunStore(Protocol):
    async def create(self, tenant: str, user_ref: str) -> RunRecord: ...
    async def get(self, run_id: str) -> RunRecord | None: ...
    async def acquire(
        self, run_id: str, allowed: tuple[str, ...], *, stale_after_seconds: float, pending_call_id: str | None = None, to_status: str = "running",
        takeover: tuple[str, ...] = ("running",),
    ) -> str | None:
        """Atomically move the run to ``to_status`` ('running', or 'executing' for a claim) and return its new lease, or None.

        A run in one of ``allowed`` qualifies (for a resume or claim only while ``pending_call_id`` is still its pending call), except an
        'executing' run not updated for ``stale_after_seconds``: its write may already have run, so only a caller that lists 'executing'
        in ``takeover`` (a new user message, which settles the unknown result) can take it. A run in ``takeover`` not updated for
        ``stale_after_seconds`` (its process is gone) qualifies too; the caller decides from the checkpoint what a stale run may do.
        """
        ...

    async def finish(self, run_id: str, status: str, lease: str | None, pending_call_id: str | None = None) -> None:
        """Record the settled status (and the pending call of a waiting run); only the lease holder of a 'running' or 'executing' run changes it."""
        ...

    async def delete_older_than(self, days: int) -> list[str]:
        """Delete runs (and checkpoints) not updated for ``days`` days (at least 1); returns their ids."""
        ...


def _require_window(days: int) -> None:
    if days < 1:
        msg = "retention window must be at least 1 day"
        raise ValueError(msg)


class MemoryRunStore:
    def __init__(self) -> None:
        self.records: dict[str, RunRecord] = {}
        self._lock = asyncio.Lock()

    async def create(self, tenant: str, user_ref: str) -> RunRecord:
        record = RunRecord(new_run_id(), tenant, user_ref, lease=new_lease())
        self.records[record.run_id] = record
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        return self.records.get(run_id)

    async def acquire(
        self, run_id: str, allowed: tuple[str, ...], *, stale_after_seconds: float, pending_call_id: str | None = None, to_status: str = "running",
        takeover: tuple[str, ...] = ("running",),
    ) -> str | None:
        async with self._lock:
            record = self.records.get(run_id)
            if record is None:
                return None
            stale = is_stale(record, stale_after_seconds)
            allowed_now = record.status in allowed and (pending_call_id is None or record.pending_call_id == pending_call_id)
            if record.status == EXECUTING and stale:
                allowed_now = False
            if not (allowed_now or (stale and record.status in takeover)):
                return None
            record.status, record.updated_at, record.lease = to_status, datetime.now(UTC), new_lease()
            return record.lease

    async def finish(self, run_id: str, status: str, lease: str | None, pending_call_id: str | None = None) -> None:
        async with self._lock:
            record = self.records.get(run_id)
            if record is not None and record.status in ACTIVE and record.lease == lease:
                record.status, record.pending_call_id, record.updated_at = status, pending_call_id, datetime.now(UTC)

    async def delete_older_than(self, days: int) -> list[str]:
        _require_window(days)
        cutoff = datetime.now(UTC) - timedelta(days=days)
        gone = [run_id for run_id, record in self.records.items() if record.updated_at < cutoff]
        for run_id in gone:
            del self.records[run_id]
        return gone


CREATE_RUNS = (
    """
CREATE TABLE IF NOT EXISTS ai_runs (
    run_id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    user_ref TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease TEXT,
    pending_call_id TEXT
)
""",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS lease TEXT",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS pending_call_id TEXT",
    "CREATE INDEX IF NOT EXISTS ai_runs_updated_at ON ai_runs (updated_at)",
)
CHECKPOINT_TABLES = ("checkpoint_writes", "checkpoint_blobs", "checkpoints")


class PostgresRunStore:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def setup(self) -> None:
        async with self.pool.connection() as conn:
            for statement in CREATE_RUNS:  # one statement per call: the pool prepares every query
                await conn.execute(statement)

    async def create(self, tenant: str, user_ref: str) -> RunRecord:
        record = RunRecord(new_run_id(), tenant, user_ref, lease=new_lease())
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO ai_runs (run_id, tenant, user_ref, status, created_at, updated_at, lease) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (record.run_id, tenant, user_ref, record.status, record.created_at, record.updated_at, record.lease),
            )
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT run_id, tenant, user_ref, status, created_at, updated_at, lease, pending_call_id FROM ai_runs WHERE run_id = %s", (run_id,),
            )).fetchone()
        return RunRecord(*row) if row else None

    async def acquire(
        self, run_id: str, allowed: tuple[str, ...], *, stale_after_seconds: float, pending_call_id: str | None = None, to_status: str = "running",
        takeover: tuple[str, ...] = ("running",),
    ) -> str | None:
        lease = new_lease()
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_runs SET status = %s, lease = %s, updated_at = now() WHERE run_id = %s AND ("
                "(status = ANY(%s) AND (%s::text IS NULL OR pending_call_id = %s::text)"
                " AND NOT (status = %s AND updated_at < now() - make_interval(secs => %s)))"
                " OR (status = ANY(%s) AND updated_at < now() - make_interval(secs => %s))) RETURNING run_id",
                (to_status, lease, run_id, list(allowed), pending_call_id, pending_call_id, EXECUTING, float(stale_after_seconds),
                 list(takeover), float(stale_after_seconds)),
            )).fetchone()
        return lease if row else None

    async def finish(self, run_id: str, status: str, lease: str | None, pending_call_id: str | None = None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE ai_runs SET status = %s, pending_call_id = %s, updated_at = now() WHERE run_id = %s AND status = ANY(%s) AND lease = %s",
                (status, pending_call_id, run_id, list(ACTIVE), lease),
            )

    async def delete_older_than(self, days: int) -> list[str]:
        _require_window(days)
        async with self.pool.connection() as conn, conn.transaction():
            # Lock the old rows first so a run resumed meanwhile blocks, then finds itself gone (409) instead of losing checkpoints alone.
            old = "SELECT run_id FROM ai_runs WHERE updated_at < now() - make_interval(days => %s) FOR UPDATE"
            for table in CHECKPOINT_TABLES:
                await conn.execute(f"DELETE FROM {table} WHERE thread_id IN ({old})", (days,))  # noqa: S608 - table from a constant tuple
            rows = await (await conn.execute(
                "DELETE FROM ai_runs WHERE updated_at < now() - make_interval(days => %s) RETURNING run_id", (days,),
            )).fetchall()
        return [row[0] for row in rows]


async def open_state(database_url: str | None) -> tuple[RunStore, object, Callable[[], Awaitable[None]]]:
    """``(store, checkpointer, aclose)``: Postgres for a URL, memory (development only) without one."""
    if not database_url:
        from langgraph.checkpoint.memory import InMemorySaver

        async def noop() -> None:
            return None

        return MemoryRunStore(), InMemorySaver(), noop

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    pool = AsyncConnectionPool(database_url, min_size=1, max_size=5, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()
    try:
        checkpointer = AsyncPostgresSaver(pool)
        await checkpointer.setup()
        store = PostgresRunStore(pool)
        await store.setup()
    except Exception:
        await pool.close()
        raise

    async def aclose() -> None:
        await pool.close()

    return store, checkpointer, aclose
