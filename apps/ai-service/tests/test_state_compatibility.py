"""Startup must inspect existing control state before any schema setup can mutate it."""
from contextlib import asynccontextmanager

import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from liwan_ai_service.control import StateCompatibilityError, open_control


class Result:
    def __init__(self, row):
        self.row = row

    async def fetchone(self):
        return self.row


class Database:
    def __init__(self, *, version="1", checkpoint_version=None, tables=None):
        self.state_id = "state_" + "a" * 32
        self.version = version
        self.checkpoint_version = len(AsyncPostgresSaver.MIGRATIONS) - 1 if checkpoint_version is None else checkpoint_version
        self.tables = tables if tables is not None else ("ai_state_schema", "ai_generations")
        self.mutations = []
        self.closed = False

    async def execute(self, sql, params=None):
        if "to_regclass" in sql:
            return Result(self.tables)
        if "FROM ai_state_schema" in sql:
            return Result((self.version, self.checkpoint_version, self.state_id))
        if sql.lstrip().upper().startswith("SELECT"):
            return Result(None)
        self.mutations.append(sql)
        return Result(None)

    @asynccontextmanager
    async def connection(self):
        yield self

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def open(self):
        return None

    async def close(self):
        self.closed = True


@pytest.fixture
def database(monkeypatch):
    database = Database()
    monkeypatch.setattr("psycopg_pool.AsyncConnectionPool", lambda *args, **kwargs: database)
    return database


async def test_compatible_runtime_opens_existing_control_state_without_any_schema_mutation(database):
    control = await open_control("postgresql://isolated/state")
    assert control.state_id == database.state_id
    await control.aclose()
    assert database.mutations == []
    assert database.closed


@pytest.mark.parametrize("kind", ["state", "checkpoint"])
async def test_incompatible_control_state_is_refused_before_setup_and_pool_is_closed(database, kind):
    if kind == "state":
        database.version = "future"
    else:
        database.checkpoint_version = 999
    with pytest.raises(StateCompatibilityError, match="ai_control_state_incompatible"):
        await open_control("postgresql://isolated/state")
    assert database.mutations == []
    assert database.closed


async def test_missing_or_partial_control_schema_never_triggers_runtime_repair(database):
    database.tables = (None, "ai_generations")
    with pytest.raises(StateCompatibilityError, match="ai_control_state_uninitialized"):
        await open_control("postgresql://isolated/state")
    assert database.mutations == []


async def test_initializing_an_empty_control_database_creates_its_two_tables(database):
    database.tables = (None, None)
    control = await open_control("postgresql://isolated/state", initialize=True)
    assert control.state_id.startswith("state_")
    await control.aclose()
    created = [statement for statement in database.mutations if statement.startswith("CREATE TABLE")]
    assert len(created) == 2 and "ai_runs" not in " ".join(database.mutations) and "checkpoints" not in " ".join(database.mutations)
    assert database.closed


async def test_initializing_an_existing_control_database_only_validates_it(database):
    control = await open_control("postgresql://isolated/state", initialize=True)
    assert control.state_id == database.state_id
    await control.aclose()
    assert database.mutations == []


@pytest.mark.parametrize("identity", [None, "configured-label", "state_" + "g" * 32])
async def test_unrecognized_control_identity_refuses_existing_schema_without_repair(database, identity):
    database.state_id = identity
    with pytest.raises(StateCompatibilityError, match="ai_control_state_incompatible"):
        await open_control("postgresql://isolated/state", initialize=True)
    assert database.mutations == []


async def test_without_a_database_the_control_state_is_memory_only():
    control = await open_control(None)
    assert control.state_id.startswith("state_")
    assert await control.generation_draining("g") is False
    await control.drain_generation("g")
    assert await control.generation_draining("g") is True
    await control.aclose()


def _cli(tmp_path, *args, database_url="postgresql://127.0.0.1:1/liwan_ai"):
    import os
    import subprocess
    import sys
    from pathlib import Path

    source = str(Path(__file__).resolve().parents[1] / "src")  # this checkout's source, not an installed copy
    return subprocess.run(
        [sys.executable, "-m", "liwan_ai_service.store", *args],
        env={**os.environ, "AI_DATABASE_URL": database_url, "PYTHONPATH": os.pathsep.join((source, os.environ.get("PYTHONPATH", "")))},
        capture_output=True, text=True, timeout=60, check=False, cwd=tmp_path,
    )


def test_initialize_tenant_rejects_bad_name(tmp_path):
    for database in ("x;drop", "Acme", "1acme", "a" * 64, ""):
        result = _cli(tmp_path, "--initialize-tenant", database)
        assert result.returncode == 1
        # The name is refused before any connection: the class is reported, never the conninfo text.
        assert "ValueError" in result.stderr and "127.0.0.1" not in result.stderr + result.stdout


def test_the_old_initialize_flag_is_gone(tmp_path):
    result = _cli(tmp_path, "--initialize")
    assert result.returncode == 2
    assert "(--initialize-control | --initialize-tenant DATABASE)" in result.stderr  # only the two explicit bootstraps remain
