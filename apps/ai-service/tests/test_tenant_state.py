"""The state pool: one store and one graph per tenant database, isolated, reopened, and closed when idle."""
import asyncio
import os
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

from liwan_ai_service.control import StateCompatibilityError
from liwan_ai_service.store import initialize_tenant
from liwan_ai_service.tenancy import DATABASE_NAME, TenantDirectory, UnknownTenant
from liwan_ai_service.tenant_state import TenantState, TenantStates

requires_postgres = pytest.mark.skipif(not os.environ.get("AI_TEST_DATABASE_URL"), reason="needs AI_TEST_DATABASE_URL")


async def state_of(states, tenant):
    async with states.use(tenant) as state:
        return state


class MappingDirectory(TenantDirectory):
    """A test directory: explicit tenant -> database names, refusing everything else."""

    def __init__(self, mapping: dict[str, str]) -> None:
        self.mapping = mapping

    def database_for(self, tenant: str) -> str:
        try:
            return self.mapping[tenant]
        except KeyError:
            msg = "tenant not served"
            raise UnknownTenant(msg) from None

    def databases(self) -> list[str]:
        return sorted(set(self.mapping.values()))


def graph_factory(checkpointer):
    return ("graph", checkpointer)


def memory_states(directory: MappingDirectory) -> TenantStates:
    return TenantStates(directory, None, graph_factory)


async def test_each_tenant_gets_its_own_store():
    states = memory_states(MappingDirectory({"a": "db_a", "b": "db_b"}))
    try:
        assert await (await state_of(states, "a")).store.create("r_1", "42") is not None
        assert (await (await state_of(states, "a")).store.get("r_1")).user_ref == "42"
        assert await (await state_of(states, "b")).store.get("r_1") is None
    finally:
        await states.aclose()


async def test_unknown_tenant_raises():
    states = memory_states(MappingDirectory({"a": "db_a"}))
    try:
        with pytest.raises(UnknownTenant):
            await state_of(states, "zzz")
    finally:
        await states.aclose()


async def test_concurrent_open_creates_one_state():
    states = memory_states(MappingDirectory({"a": "db_a"}))
    try:
        results = await asyncio.gather(*(state_of(states, "a") for _ in range(20)))
        assert all(state is results[0] for state in results)
        assert isinstance(results[0], TenantState) and results[0].graph[0] == "graph"
    finally:
        await states.aclose()


async def test_each_yields_every_database():
    states = memory_states(MappingDirectory({"a": "db_a", "b": "db_b"}))
    try:
        assert [state.database async for state in states.each()] == ["db_a", "db_b"]
    finally:
        await states.aclose()


async def test_a_memory_state_is_kept_for_the_process():
    states = memory_states(MappingDirectory({"a": "db_a"}))
    try:
        first = await state_of(states, "a")
        await states.close_idle()
        assert await state_of(states, "a") is first
    finally:
        await states.aclose()


def database_url() -> str:
    return os.environ["AI_TEST_DATABASE_URL"]


def tenant_conninfo(database: str) -> str:
    return make_conninfo(database_url(), dbname=database, options="-c search_path=liwan_ai")


async def execute(database: str | None, statement) -> None:
    conninfo = database_url() if database is None else make_conninfo(database_url(), dbname=database)
    async with await psycopg.AsyncConnection.connect(conninfo, autocommit=True) as conn:
        await conn.execute(statement)


class ScratchDatabase:
    """A throwaway database ``ai_t_<hex>`` with schema ``liwan_ai``, dropped with all its connections afterwards."""

    def __init__(self) -> None:
        self.name = "ai_t_" + uuid4().hex[:12]

    async def create(self) -> str:
        assert DATABASE_NAME.fullmatch(self.name)
        await execute(None, sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.name)))
        await execute(self.name, "CREATE SCHEMA liwan_ai")
        return tenant_conninfo(self.name)

    async def drop(self) -> None:
        await execute(None, sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(self.name)))


@requires_postgres
async def test_uninitialized_tenant_is_503():
    uninitialized, initialized = ScratchDatabase(), ScratchDatabase()
    await uninitialized.create()
    await initialized.create()
    await initialize_tenant(tenant_conninfo(initialized.name))
    states = TenantStates(
        MappingDirectory({"a": uninitialized.name, "b": initialized.name}), database_url(), graph_factory,
    )
    try:
        with pytest.raises(StateCompatibilityError, match="ai_state_uninitialized"):
            await state_of(states, "a")
        working = await state_of(states, "b")
        assert await working.store.create("r_1", "42") is not None
        assert (await working.store.get("r_1")).user_ref == "42"
        # The refused tenant cached nothing; a sweep skips it and keeps serving the initialized one.
        assert [state.database async for state in states.each()] == [initialized.name]
        assert await (await state_of(states, "b")).store.get("r_1") is not None
    finally:
        await states.aclose()
        await uninitialized.drop()
        await initialized.drop()


@requires_postgres
async def test_lru_closes_oldest_pool():
    first, second = ScratchDatabase(), ScratchDatabase()
    await first.create()
    await second.create()
    await initialize_tenant(tenant_conninfo(first.name))
    await initialize_tenant(tenant_conninfo(second.name))
    states = TenantStates(
        MappingDirectory({"a": first.name, "b": second.name}), database_url(), graph_factory, max_open=1,
    )
    try:
        first_state = await state_of(states, "a")
        assert first_state.store.pool.closed is False
        second_state = await state_of(states, "b")
        assert second_state.store.pool.closed is False
        assert first_state.store.pool.closed is True  # the least recently used pool made room for the new one
        reopened = await state_of(states, "a")
        assert reopened is not first_state and reopened.store.pool.closed is False
        assert await reopened.store.create("r_1", "42") is not None
    finally:
        await states.aclose()
        await first.drop()
        await second.drop()


@requires_postgres
async def test_close_idle_closes_a_pool_unused_for_the_idle_window():
    scratch = ScratchDatabase()
    await scratch.create()
    await initialize_tenant(tenant_conninfo(scratch.name))
    states = TenantStates(MappingDirectory({"a": scratch.name}), database_url(), graph_factory, idle_seconds=0)
    try:
        state = await state_of(states, "a")
        await asyncio.sleep(0.01)
        await states.close_idle()
        assert state.store.pool.closed is True
    finally:
        await states.aclose()
        await scratch.drop()


@requires_postgres
async def test_a_pool_in_use_is_neither_idle_closed_nor_evicted():
    first, second = ScratchDatabase(), ScratchDatabase()
    await first.create()
    await second.create()
    await initialize_tenant(tenant_conninfo(first.name))
    await initialize_tenant(tenant_conninfo(second.name))
    states = TenantStates(
        MappingDirectory({"a": first.name, "b": second.name}), database_url(), graph_factory, max_open=1, idle_seconds=0,
    )
    try:
        async with states.use("a") as busy:
            await asyncio.sleep(0.01)
            await states.close_idle()
            other = await state_of(states, "b")  # max_open is exceeded rather than closing the busy pool
            assert busy.store.pool.closed is False and other.store.pool.closed is False
            assert await busy.store.create("r_1", "42") is not None
        await asyncio.sleep(0.01)
        await states.close_idle()
        assert busy.store.pool.closed is True
    finally:
        await states.aclose()
        await first.drop()
        await second.drop()
