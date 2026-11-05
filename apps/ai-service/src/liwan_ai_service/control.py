"""Release control state (the deployment identity and generation draining) in the small service database.

Tenant content lives in each tenant database; this database holds only what the blue/green release coordinator
needs, so it is opened once, not per tenant. The runtime only validates it: DDL runs from the operator bootstrap.
"""
from __future__ import annotations

import asyncio
import re
from typing import Protocol
from uuid import uuid4

from liwan_ai_service.contracts import AI_STATE_VERSION

CONTROL_LOCK = (184732, 1)  # operator-only session lock: serializes bootstrap across processes
STATE_ID = re.compile(r"^state_[a-f0-9]{32}$")


class StateCompatibilityError(RuntimeError):
    """State needs explicit operator initialization or an offline migration, never runtime setup."""


class ControlState(Protocol):
    state_id: str

    async def generation_draining(self, generation_id: str) -> bool: ...
    async def drain_generation(self, generation_id: str) -> None: ...
    async def aclose(self) -> None: ...


class MemoryControlState(ControlState):
    """Development and tests only: the identity is per process and a drain is forgotten on restart."""

    def __init__(self) -> None:
        self.state_id = "state_" + uuid4().hex
        self._drained_generations: set[str] = set()
        self._lock = asyncio.Lock()

    async def generation_draining(self, generation_id: str) -> bool:
        return generation_id in self._drained_generations

    async def drain_generation(self, generation_id: str) -> None:
        async with self._lock:
            self._drained_generations.add(generation_id)

    async def aclose(self) -> None:
        return None


class PostgresControlState:
    def __init__(self, pool, state_id: str) -> None:
        self.pool = pool
        self.state_id = state_id

    async def generation_draining(self, generation_id: str) -> bool:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT draining FROM ai_generations WHERE generation_id = %s", (generation_id,),
            )).fetchone()
        return bool(row and row[0])

    async def drain_generation(self, generation_id: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO ai_generations (generation_id, draining) VALUES (%s, true)"
                " ON CONFLICT (generation_id) DO UPDATE SET draining = true", (generation_id,),
            )

    async def aclose(self) -> None:
        await self.pool.close()


async def open_control(database_url: str | None, *, initialize: bool = False) -> ControlState:
    """Open the release control state; only an explicit operator bootstrap runs setup."""
    if not database_url:
        return MemoryControlState()

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool

    checkpoint_version = len(AsyncPostgresSaver.MIGRATIONS) - 1
    pool = AsyncConnectionPool(database_url, min_size=1, max_size=5, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False)
    await pool.open()
    try:
        async with pool.connection() as conn:
            state_id = await _initialize_control(conn, checkpoint_version) if initialize else await _validate_control(conn, checkpoint_version)
    except Exception:
        await pool.close()
        raise
    return PostgresControlState(pool, state_id)


async def _control_tables(conn):
    return await (await conn.execute(
        "SELECT to_regclass('ai_state_schema'), to_regclass('ai_generations')",
    )).fetchone()


async def _validate_control(conn, checkpoint_version: int) -> str:
    tables = await _control_tables(conn)
    if not tables or len(tables) != 2 or not all(tables):
        raise StateCompatibilityError("ai_control_state_uninitialized")
    version = await (await conn.execute("SELECT state_version, checkpoint_version, state_id FROM ai_state_schema WHERE singleton")).fetchone()
    if (not version or len(version) != 3 or version[:2] != (AI_STATE_VERSION, checkpoint_version)
            or not STATE_ID.fullmatch(str(version[2]))):
        raise StateCompatibilityError("ai_control_state_incompatible")
    return version[2]


async def _initialize_control(conn, checkpoint_version: int) -> str:
    # Operator-only session lock also serializes bootstrap across processes. Runtime never takes this lock or runs DDL.
    await conn.execute(f"SELECT pg_advisory_lock({CONTROL_LOCK[0]}, {CONTROL_LOCK[1]})")
    try:
        tables = await _control_tables(conn)
        if any(tables):
            return await _validate_control(conn, checkpoint_version)
        async with conn.transaction():  # both tables or neither, so an interrupted bootstrap can simply rerun
            await conn.execute(
                "CREATE TABLE ai_state_schema (singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),"
                " state_version TEXT NOT NULL, checkpoint_version INTEGER NOT NULL,"
                " state_id TEXT NOT NULL UNIQUE CHECK (state_id ~ '^state_[a-f0-9]{32}$'))",
            )
            state_id = "state_" + uuid4().hex
            await conn.execute(
                "INSERT INTO ai_state_schema (state_version, checkpoint_version, state_id) VALUES (%s, %s, %s)",
                (AI_STATE_VERSION, checkpoint_version, state_id),
            )
            await conn.execute(
                "CREATE TABLE ai_generations (generation_id TEXT PRIMARY KEY CHECK (generation_id ~ '^[a-z][a-z0-9_-]{0,62}$'),"
                " draining BOOLEAN NOT NULL)",
            )
        return state_id
    finally:
        await conn.execute(f"SELECT pg_advisory_unlock({CONTROL_LOCK[0]}, {CONTROL_LOCK[1]})")
