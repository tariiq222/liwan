"""Startup must inspect existing state before any schema or checkpoint setup can mutate it."""
from contextlib import asynccontextmanager

import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from liwan_ai_service.store import open_state


class Result:
    def __init__(self, row):
        self.row = row

    async def fetchone(self):
        return self.row


class Database:
    def __init__(self, *, version="1", checkpoint_version=None):
        self.state_id = "state_" + "a" * 32
        self.version = version
        self.checkpoint_version = len(AsyncPostgresSaver.MIGRATIONS) - 1 if checkpoint_version is None else checkpoint_version
        self.mutations = []
        self.closed = False

    async def execute(self, sql, params=None):
        if "to_regclass" in sql:
            return Result(("ai_state_schema", "ai_runs", "checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations", "ai_generations"))
        if "FROM ai_state_schema" in sql:
            return Result((self.version, self.checkpoint_version, self.state_id))
        if "FROM checkpoint_migrations" in sql:
            return Result((self.checkpoint_version,))
        if sql.lstrip().upper().startswith("SELECT"):
            return Result(None)
        self.mutations.append(sql)
        return Result(None)

    @asynccontextmanager
    async def connection(self):
        yield self

    async def open(self):
        return None

    async def close(self):
        self.closed = True


@pytest.fixture
def database(monkeypatch):
    database = Database()
    monkeypatch.setattr("psycopg_pool.AsyncConnectionPool", lambda *args, **kwargs: database)

    async def setup(_self):
        database.mutations.append("checkpoint setup")

    monkeypatch.setattr(AsyncPostgresSaver, "setup", setup)
    return database


async def test_compatible_runtime_opens_existing_state_without_any_schema_mutation(database):
    store, _, close = await open_state("postgresql://isolated/state")
    assert store.state_id == database.state_id
    await close()
    assert database.mutations == []
    assert database.closed


@pytest.mark.parametrize("kind", ["state", "checkpoint"])
async def test_incompatible_state_is_refused_before_setup_and_pool_is_closed(database, kind):
    if kind == "state":
        database.version = "future"
    else:
        database.checkpoint_version = 999
    with pytest.raises(RuntimeError, match="incompatible"):
        await open_state("postgresql://isolated/state")
    assert database.mutations == []
    assert database.closed


async def test_missing_or_partial_schema_never_triggers_runtime_or_operator_repair(database, monkeypatch):
    original = database.execute

    async def partial(sql, params=None):
        if "to_regclass" in sql:
            return Result((None, "ai_runs", None, None, None, None))
        return await original(sql, params)

    monkeypatch.setattr(database, "execute", partial)
    for initialize in (False, True):
        with pytest.raises(RuntimeError, match="uninitialized or incompatible"):
            await open_state("postgresql://isolated/state", initialize=initialize)
    assert database.mutations == []


@pytest.mark.parametrize("identity", [None, "configured-label", "state_" + "g" * 32])
async def test_unrecognized_state_identity_refuses_existing_schema_without_repair(database, identity):
    database.state_id = identity
    for initialize in (False, True):
        with pytest.raises(RuntimeError, match="incompatible"):
            await open_state("postgresql://isolated/state", initialize=initialize)
    assert database.mutations == []
