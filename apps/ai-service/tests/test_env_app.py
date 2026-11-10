"""The env-configured app opens its state on the serving loop (no pool bound to a dead loop)."""
import logging

import httpx

from liwan_ai_service import service
from liwan_ai_service.control import MemoryControlState
from liwan_ai_service.service import EnvApp
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE
from liwan_ai_service.tenant_state import TenantStates
from tests.platform_file import platform_env, write_platform_file


async def test_env_app_runs_its_lifespan_and_serves(monkeypatch):
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    app = EnvApp()
    sent = []
    queue = [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message["type"])
        if message["type"] == "lifespan.startup.complete":
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
                assert (await client.get("/healthz")).json() == {"ok": True}

    await app({"type": "lifespan"}, receive, send)
    assert sent == ["lifespan.startup.complete", "lifespan.shutdown.complete"]


async def test_startup_failure_is_reported_not_swallowed(monkeypatch):
    monkeypatch.delenv(PLATFORM_PROVIDER_FILE, raising=False)
    app = EnvApp()
    sent = []

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        sent.append(message)

    await app({"type": "lifespan"}, receive, send)
    assert sent[0] == {"type": "lifespan.startup.failed", "message": f"SettingsError: {PLATFORM_PROVIDER_FILE}"}


async def run_startup(monkeypatch, *, build_error):
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    closed = []

    class Control(MemoryControlState):
        async def aclose(self):
            closed.append(True)

    async def fake_open_control(_url):
        return Control()

    def failing_create_app(*_args):
        raise build_error

    monkeypatch.setattr(service, "open_control", fake_open_control)
    monkeypatch.setattr(service, "create_app", failing_create_app)
    sent = []

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        sent.append(message)

    await EnvApp()({"type": "lifespan"}, receive, send)
    return sent, closed


async def test_startup_failure_names_only_the_error_class_and_closes_the_state(monkeypatch):
    sent, closed = await run_startup(monkeypatch, build_error=RuntimeError("could not connect postgresql://u:pw@h/db sk-secret"))
    assert sent == [{"type": "lifespan.startup.failed", "message": "RuntimeError"}]
    assert closed == [True]


async def test_cleanup_failure_prints_only_the_error_class(monkeypatch, capsys):
    from liwan_ai_service import cleanup

    def failing_open_tenant_states(_url):
        raise RuntimeError("could not connect postgresql://u:pw@h/db sk-secret")

    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://u:pw@h/db")
    monkeypatch.setattr(cleanup, "open_tenant_states", failing_open_tenant_states)
    assert await cleanup.main() == 1
    captured = capsys.readouterr()
    assert "RuntimeError" in captured.err
    for secret in ("u:pw@h", "sk-secret", "postgresql://"):
        assert secret not in captured.out + captured.err


async def test_shutdown_waits_for_the_persist_tasks_before_closing_the_state(monkeypatch):

    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    order = []

    class Control(MemoryControlState):
        async def aclose(self):
            order.append("state closed")

    async def fake_open_control(_url):
        return Control()

    monkeypatch.setattr(service, "open_control", fake_open_control)
    app = EnvApp()
    queue = [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        if message["type"] == "lifespan.startup.complete":
            drain = app.inner.state.drain

            async def recording_drain():
                order.append("drained")
                await drain()

            app.inner.state.drain = recording_drain

    await app({"type": "lifespan"}, receive, send)
    assert order == ["drained", "state closed"]


async def start_env_app():
    app, sent, queue = EnvApp(), [], [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    await app({"type": "lifespan"}, receive, send)
    return sent


async def test_boot_without_a_database_fails_unless_memory_state_is_allowed(monkeypatch):
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_ALLOW_MEMORY_STATE", raising=False)
    assert await start_env_app() == [{"type": "lifespan.startup.failed", "message": "SettingsError: AI_DATABASE_URL"}]


async def test_memory_boot_warns_once_about_state_and_about_the_missing_token_without_secrets(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="liwan_ai_service")
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    assert (await start_env_app())[0] == {"type": "lifespan.startup.complete"}
    texts = [record.getMessage() for record in caplog.records]
    assert sum("memory" in text for text in texts) == 1 and sum("AI_DEV_INSECURE" in text for text in texts) == 1


async def test_a_database_boot_opens_only_the_control_state(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="liwan_ai_service")
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://u:pw@h/db")
    monkeypatch.setenv("AI_TENANT_DATABASE", "acme_db")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "t" * 30)
    closed, calls, pools = [], [], []

    class Control(MemoryControlState):
        async def aclose(self):
            closed.append(True)

    async def fake_open_control(url, *, initialize=False):
        calls.append((url, initialize))
        return Control()

    async def record_pool_open(self, conninfo):
        pools.append(conninfo)  # a tenant pool opened at boot would block here
        raise AssertionError("a tenant pool must open lazily on its first request")

    monkeypatch.setattr(service, "open_control", fake_open_control)
    monkeypatch.setattr(TenantStates, "_open_pool", record_pool_open)
    # The tenant states connect to a database that does not exist here: boot must not touch it.
    assert await start_env_app() == [{"type": "lifespan.startup.complete"}, {"type": "lifespan.shutdown.complete"}]
    assert calls == [("postgresql://u:pw@h/db", False)] and pools == []
    assert closed == [True] and caplog.records == []


async def test_a_missing_platform_file_stops_the_start_naming_the_variable_and_the_compose_directory(monkeypatch, tmp_path):
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, str(tmp_path / "absent.json"))
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    (failed,) = await start_env_app()
    assert failed["type"] == "lifespan.startup.failed"
    assert PLATFORM_PROVIDER_FILE in failed["message"] and "unreadable" in failed["message"] and "LIWAN_AI_PLATFORM_DIR" in failed["message"]


async def test_an_invalid_platform_file_names_the_field_and_never_a_value(monkeypatch, tmp_path):
    path = tmp_path / "p.json"
    write_platform_file(path, "openai", "m", api_key="sk-secret-value", revision=0)
    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, str(path))
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_DEV_INSECURE", "true")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    (failed,) = await start_env_app()
    assert "revision" in failed["message"] and "sk-secret-value" not in failed["message"]
