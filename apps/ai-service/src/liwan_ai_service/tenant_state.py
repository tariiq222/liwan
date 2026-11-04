"""One store and one graph per tenant database, opened on demand and closed when idle.

The database is the tenant boundary: a tenant's runs, checkpoints and graph live in its own pool, never in a
shared one. Release control state (the deployment identity) stays in ``control.py``. The runtime only validates
a tenant schema; the operator bootstrap creates it.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass

from psycopg.conninfo import make_conninfo

from liwan_ai_service.control import StateCompatibilityError
from liwan_ai_service.store import MemoryRunStore, PostgresRunStore, RunStore, validate_tenant
from liwan_ai_service.tenancy import TenantDirectory

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TenantState:
    database: str
    store: RunStore
    graph: object


class TenantStates:
    """Every served tenant's state: memory for development, a bounded pool per database in production."""

    def __init__(
        self,
        directory: TenantDirectory,
        base_conninfo: str | None,
        graph_factory: Callable[[object], object],
        *,
        max_open: int = 32,
        idle_seconds: float = 300,
        pool_max_size: int = 5,
    ) -> None:
        if max_open < 1:
            msg = "max_open must be at least 1"
            raise ValueError(msg)
        self.directory = directory
        self.base_conninfo = base_conninfo
        self.graph_factory = graph_factory
        self.max_open = max_open
        self.idle_seconds = idle_seconds
        self.pool_max_size = pool_max_size
        self._states: dict[str, TenantState] = {}
        self._pools: dict[str, object] = {}
        self._used_at: dict[str, float] = {}
        self._touches: dict[str, int] = {}  # a new id per use: a sweep sees whether a request used the state since
        self._sequence = 0
        self._active: dict[str, int] = {}  # requests and sweeps using a state now: its pool is never closed under them
        self._locks: dict[str, asyncio.Lock] = {}
        self._pool_changes = asyncio.Lock()  # opening, evicting and closing a pool never interleave

    @asynccontextmanager
    async def use(self, tenant: str) -> AsyncIterator[TenantState]:
        """The tenant's state, kept open until the block ends; ``UnknownTenant`` when this deployment does not serve it.

        Idle and least-recently-used closing skip a state in use, so a long run never loses its pool midway.
        """
        database = self.directory.database_for(tenant)
        state = await self._state_for(database)
        try:
            yield state
        finally:
            self._release(database)

    async def each(self) -> AsyncIterator[TenantState]:
        """Every served tenant's state in directory order, skipping a database whose state was never initialized.

        The Postgres states this iteration itself opened are closed afterwards, unless a request used them
        meanwhile; a memory state lives for the process.
        """
        opened: dict[str, int] = {}
        try:
            for database in self.directory.databases():
                try:
                    state = await self._state_for(database, opened)
                except StateCompatibilityError:
                    log.warning("database %s has no initialized AI state; skipped", database)
                    continue
                try:
                    yield state
                finally:
                    self._release(database, touch=False)  # a sweep is not a use: it must not keep the pool open
        finally:
            await self._close_opened(opened)

    async def close_idle(self) -> None:
        """Close every Postgres pool unused for more than ``idle_seconds``."""
        cutoff = time.monotonic() - self.idle_seconds
        await self._close_where(lambda database: self._used_at[database] < cutoff)

    async def aclose(self) -> None:
        await self._close_where(lambda database: True, include_active=True)  # shutdown: nothing may outlive it
        self._states.clear()  # memory states have nothing to close, but they are caches too
        self._used_at.clear()
        self._touches.clear()

    async def _state_for(self, database: str, opened: dict[str, int] | None = None) -> TenantState:
        """The cached state of one database, opened and cached once even for concurrent callers.

        With ``opened``, a state this call itself opened is recorded so a sweep can close it afterwards.
        """
        async with self._lock_for(database):  # one opener per database: concurrent callers share one state
            cached = self._states.get(database)
            if cached is None:
                state = await self._open(database)
                self._touch(database)
                if opened is not None:
                    opened[database] = self._touches[database]
            else:
                state = cached
                self._touch(database)
            self._active[database] = self._active.get(database, 0) + 1  # same step as the lookup: no close in between
            return state

    async def _open(self, database: str) -> TenantState:
        """Open and cache one database's state; a failure caches nothing and reaches the caller unchanged.

        Eviction, opening and registration hold one lock, so the bound over open pools is strict and the least
        recently used pool is closed before the new one is opened. A per-database lock already serializes opens
        of the same database, so this only orders different ones.
        """
        async with self._pool_changes:
            for evicted in self._evict_oldest():
                await evicted.close()
            state, pool = await self._build(database)
            if pool is not None:
                self._pools[database] = pool
            self._states[database] = state
            return state

    async def _build(self, database: str) -> tuple[TenantState, object | None]:
        if self.base_conninfo is None:
            return self._memory_state(database), None
        return await self._postgres_state(database)

    def _memory_state(self, database: str) -> TenantState:
        from langgraph.checkpoint.memory import InMemorySaver

        return TenantState(database, MemoryRunStore(), self.graph_factory(InMemorySaver()))

    async def _postgres_state(self, database: str) -> tuple[TenantState, object]:
        conninfo = make_conninfo(self.base_conninfo, dbname=database, options="-c search_path=liwan_ai")
        pool, checkpointer = await self._open_pool(conninfo)
        try:
            return TenantState(database, PostgresRunStore(pool), self.graph_factory(checkpointer)), pool
        except BaseException:
            await pool.close()
            raise

    async def _open_pool(self, conninfo: str):
        """A pool of one tenant database, opened and validated before any request uses it."""
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from psycopg_pool import AsyncConnectionPool

        pool = AsyncConnectionPool(
            conninfo, min_size=0, max_size=self.pool_max_size, kwargs={"autocommit": True, "prepare_threshold": 0}, open=False,
        )
        try:
            await pool.open()
            async with pool.connection() as conn:
                await validate_tenant(conn, len(AsyncPostgresSaver.MIGRATIONS) - 1)
        except BaseException:
            await pool.close()
            raise
        return pool, AsyncPostgresSaver(pool)

    def _evict_oldest(self) -> list[object]:
        """Forget the least recently used idle pools while one more open state would exceed ``max_open``.

        Pools in use are never evicted, so the bound may be exceeded while every open pool is busy.
        """
        evicted = []
        while len(self._pools) >= self.max_open:
            idle = [database for database in self._pools if not self._active.get(database)]
            if not idle:
                log.warning("all %d open AI state pools are in use; opening one more", len(self._pools))
                break
            pool = self._forget(min(idle, key=lambda database: self._used_at[database]))
            if pool is not None:
                evicted.append(pool)
        return evicted

    async def _close_opened(self, opened: dict[str, int]) -> None:
        if self.base_conninfo is None:
            return
        await self._close_where(
            lambda database: database in opened  # only a state no request used since this sweep itself opened it
            and self._touches.get(database) == opened[database],
        )

    async def _close_where(self, close, *, include_active: bool = False) -> None:
        """Remove the matching Postgres pools that nothing uses from the cache, then close them."""
        async with self._pool_changes:
            pools = [self._forget(database) for database in list(self._pools)
                     if (include_active or not self._active.get(database)) and close(database)]
            for pool in pools:
                if pool is not None:
                    await pool.close()

    def _forget(self, database: str) -> object | None:
        self._states.pop(database, None)
        self._used_at.pop(database, None)
        self._touches.pop(database, None)
        return self._pools.pop(database, None)

    def _release(self, database: str, *, touch: bool = True) -> None:
        remaining = self._active.get(database, 0) - 1
        if remaining > 0:
            self._active[database] = remaining
        else:
            self._active.pop(database, None)
        if touch and database in self._used_at:
            self._touch(database)  # idle time counts from the end of the last use, not its start

    def _touch(self, database: str) -> None:
        self._sequence += 1
        self._used_at[database] = time.monotonic()
        self._touches[database] = self._sequence

    def _lock_for(self, database: str) -> asyncio.Lock:
        lock = self._locks.get(database)
        if lock is None:
            lock = self._locks[database] = asyncio.Lock()
        return lock
