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
    title: str | None = None
    title_locked: bool = False  # true once the user renamed the conversation: the AI never overwrites it
    archived_at: datetime | None = None


class RunStore(Protocol):
    async def create(self, tenant: str, user_ref: str, title: str | None = None) -> RunRecord: ...
    async def get(self, run_id: str) -> RunRecord | None: ...
    async def list_for_owner(self, tenant: str, user_ref: str, limit: int = 50, *, archived: bool = False) -> list[RunRecord]:
        """The owner's active runs (or, with ``archived``, only the archived ones), most recently updated first; never another tenant's or user's."""
        ...
    async def set_generated_title(self, run_id: str, title: str) -> bool:
        """Title the run unless the user renamed it; True when the title was written. Touches neither the status nor the lease."""
        ...
    async def update_meta(self, run_id: str, *, title: str | None = None, archived: bool | None = None) -> RunRecord | None:
        """Apply a user's rename (which locks the title) and/or archive flag; returns the run, or None when it is gone.

        Touches neither the status, the lease nor ``updated_at``: archiving a run that is still executing leaves it settle normally.
        """
        ...
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

    async def create(self, tenant: str, user_ref: str, title: str | None = None) -> RunRecord:
        record = RunRecord(new_run_id(), tenant, user_ref, lease=new_lease(), title=title)
        self.records[record.run_id] = record
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        return self.records.get(run_id)

    async def list_for_owner(self, tenant: str, user_ref: str, limit: int = 50, *, archived: bool = False) -> list[RunRecord]:
        owned = [
            record for record in self.records.values()
            if record.tenant == tenant and record.user_ref == user_ref and (record.archived_at is not None) == archived
        ]
        return sorted(owned, key=lambda record: record.updated_at, reverse=True)[:limit]

    async def set_generated_title(self, run_id: str, title: str) -> bool:
        record = self.records.get(run_id)
        if record is None or record.title_locked:
            return False
        record.title = title
        return True

    async def update_meta(self, run_id: str, *, title: str | None = None, archived: bool | None = None) -> RunRecord | None:
        record = self.records.get(run_id)
        if record is None:
            return None
        if title is not None:
            record.title, record.title_locked = title, True
        if archived is not None:
            record.archived_at = (record.archived_at or datetime.now(UTC)) if archived else None
        return record

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
    pending_call_id TEXT,
    title TEXT,
    title_locked BOOLEAN NOT NULL DEFAULT false,
    archived_at TIMESTAMPTZ
)
""",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS lease TEXT",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS pending_call_id TEXT",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS title TEXT",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS title_locked BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS ai_runs_updated_at ON ai_runs (updated_at)",
    "CREATE INDEX IF NOT EXISTS ai_runs_owner_updated_at ON ai_runs (tenant, user_ref, updated_at DESC)",
)
_OLD_RUN_IDS = "SELECT run_id FROM ai_runs WHERE updated_at < now() - make_interval(days => %s) FOR UPDATE"
DELETE_OLD_CHECKPOINTS = (
    "DELETE FROM checkpoint_writes WHERE thread_id IN (" + _OLD_RUN_IDS + ")",
    "DELETE FROM checkpoint_blobs WHERE thread_id IN (" + _OLD_RUN_IDS + ")",
    "DELETE FROM checkpoints WHERE thread_id IN (" + _OLD_RUN_IDS + ")",
)


class PostgresRunStore:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def setup(self) -> None:
        async with self.pool.connection() as conn:
            for statement in CREATE_RUNS:  # one statement per call: the pool prepares every query
                await conn.execute(statement)

    async def create(self, tenant: str, user_ref: str, title: str | None = None) -> RunRecord:
        record = RunRecord(new_run_id(), tenant, user_ref, lease=new_lease(), title=title)
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO ai_runs (run_id, tenant, user_ref, status, created_at, updated_at, lease, title)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (record.run_id, tenant, user_ref, record.status, record.created_at, record.updated_at, record.lease, title),
            )
        return record

    async def get(self, run_id: str) -> RunRecord | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT run_id, tenant, user_ref, status, created_at, updated_at, lease, pending_call_id, title, title_locked, archived_at "
                "FROM ai_runs WHERE run_id = %s", (run_id,),
            )).fetchone()
        return RunRecord(*row) if row else None

    async def list_for_owner(self, tenant: str, user_ref: str, limit: int = 50, *, archived: bool = False) -> list[RunRecord]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT run_id, tenant, user_ref, status, created_at, updated_at, lease, pending_call_id, title, title_locked, archived_at "
                "FROM ai_runs WHERE tenant = %s AND user_ref = %s AND (archived_at IS NOT NULL) = %s ORDER BY updated_at DESC LIMIT %s",
                (tenant, user_ref, archived, limit),
            )).fetchall()
        return [RunRecord(*row) for row in rows]

    async def set_generated_title(self, run_id: str, title: str) -> bool:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_runs SET title = %s WHERE run_id = %s AND NOT title_locked RETURNING run_id", (title, run_id),
            )).fetchone()
        return row is not None

    async def update_meta(self, run_id: str, *, title: str | None = None, archived: bool | None = None) -> RunRecord | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "UPDATE ai_runs SET title = COALESCE(%s::text, title), title_locked = title_locked OR %s::text IS NOT NULL,"
                " archived_at = CASE WHEN %s::boolean IS NULL THEN archived_at WHEN %s::boolean THEN COALESCE(archived_at, now()) END"
                " WHERE run_id = %s RETURNING run_id, tenant, user_ref, status, created_at, updated_at, lease, pending_call_id,"
                " title, title_locked, archived_at",
                (title, title, archived, archived, run_id),
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
            for statement in DELETE_OLD_CHECKPOINTS:
                await conn.execute(statement, (days,))
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
