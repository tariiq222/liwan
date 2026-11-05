"""Retention covers every tenant database: one tenant's failure is reported alone and stops no other."""
from datetime import timedelta

from liwan_ai_service import cleanup
from liwan_ai_service.control import StateCompatibilityError
from liwan_ai_service.store import MemoryRunStore
from liwan_ai_service.tenancy import TenantDirectory, UnknownTenant
from liwan_ai_service.tenant_state import TenantState, TenantStates
from tests.fakes import new_id

RETENTION_DAYS = 30


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


class SeedStates(TenantStates):
    """Memory tenant states that keep the store they gave each database, so a test can seed and inspect it."""

    def __init__(self, directory: TenantDirectory) -> None:
        super().__init__(directory, None, lambda _checkpointer: None)
        self.stores: dict[str, MemoryRunStore] = {}

    def _memory_state(self, database: str) -> TenantState:
        store = self.new_store(database)
        self.stores[database] = store
        return TenantState(database, store, self.graph_factory(None))

    def new_store(self, database: str) -> MemoryRunStore:
        return MemoryRunStore()


class FailingStore(MemoryRunStore):
    async def delete_older_than(self, days: int) -> list[str]:
        raise RuntimeError("postgresql://u:pw@h/db")


class OneFailingStates(SeedStates):
    """Tenant ``a``'s store refuses retention; ``b``'s works."""

    def new_store(self, database: str) -> MemoryRunStore:
        return FailingStore() if database == "a" else MemoryRunStore()


async def open_store(states: TenantStates, tenant: str) -> MemoryRunStore:
    """The tenant's store, kept open for the process, with one run old enough for retention to delete."""
    async with states.use(tenant) as state:
        record = await state.store.create(new_id(), "42")
        assert record is not None
        state.store.records[record.run_id].updated_at -= timedelta(days=RETENTION_DAYS + 10)
        return state.store


def set_cleanup_env(monkeypatch) -> None:
    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://ai@db/ai")
    monkeypatch.setenv("AI_RUN_RETENTION_DAYS", str(RETENTION_DAYS))


async def test_cleanup_covers_every_tenant(monkeypatch):
    states = SeedStates(MappingDirectory({"a": "a", "b": "b"}))
    for tenant in ("a", "b"):
        store = await open_store(states, tenant)
        assert list(store.records)  # one old run waits in each tenant
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    set_cleanup_env(monkeypatch)

    report, failures = await cleanup.run()

    assert report == "deleted 2 runs past their retention in 2 tenants"
    assert failures == []
    assert all(store.records == {} for store in states.stores.values())


async def test_cleanup_continues_after_one_tenant_fails(monkeypatch, capsys):
    states = OneFailingStates(MappingDirectory({"a": "a", "b": "b"}))
    await open_store(states, "b")  # only the working tenant needs a run to delete
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    set_cleanup_env(monkeypatch)

    assert await cleanup.main() == 1

    captured = capsys.readouterr()
    assert captured.out.strip() == "deleted 1 runs past their retention in 1 tenants"
    assert "cleanup failed for a: RuntimeError" in captured.err
    for secret in ("postgresql://", "u:pw"):
        assert secret not in captured.out + captured.err
    assert states.stores["b"].records == {}


class UnreachableStates(SeedStates):
    """Tenant ``a``'s database cannot even be opened; ``b``'s works."""

    def _memory_state(self, database: str) -> TenantState:
        if database == "a":
            raise ConnectionError("postgresql://u:pw@h/a refused")
        return super()._memory_state(database)


async def test_cleanup_continues_past_a_database_it_cannot_open(monkeypatch, capsys):
    states = UnreachableStates(MappingDirectory({"a": "a", "b": "b"}))
    await open_store(states, "b")
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    set_cleanup_env(monkeypatch)

    assert await cleanup.main() == 1

    captured = capsys.readouterr()
    assert captured.out.strip() == "deleted 1 runs past their retention in 1 tenants"
    assert "cleanup failed for a: ConnectionError" in captured.err
    assert "u:pw" not in captured.out + captured.err
    assert states.stores["b"].records == {}


async def test_an_empty_directory_is_a_failure_not_a_clean_run(monkeypatch, capsys):
    states = SeedStates(MappingDirectory({}))  # a missing or pending registry serves no tenant
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    set_cleanup_env(monkeypatch)

    assert await cleanup.main() == 1
    assert "cleanup failed for directory: no tenant database served" in capsys.readouterr().err


class IncompatibleStates(SeedStates):
    """Tenant ``a`` holds AI state from another version; ``b``'s is current."""

    def _memory_state(self, database: str) -> TenantState:
        if database == "a":
            raise StateCompatibilityError("ai_state_incompatible")
        return super()._memory_state(database)


async def test_an_incompatible_tenant_is_reported_not_skipped(monkeypatch, capsys):
    states = IncompatibleStates(MappingDirectory({"a": "a", "b": "b"}))
    await open_store(states, "b")
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    set_cleanup_env(monkeypatch)

    assert await cleanup.main() == 1
    assert "cleanup failed for a: StateCompatibilityError" in capsys.readouterr().err
    assert states.stores["b"].records == {}
