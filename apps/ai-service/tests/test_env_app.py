"""The env-configured app opens its state on the serving loop (no pool bound to a dead loop)."""
import logging

import httpx

from webvue_ai_service import service
from webvue_ai_service.service import EnvApp
from webvue_ai_service.store import MemoryRunStore


async def test_env_app_runs_its_lifespan_and_serves(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
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
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    app = EnvApp()
    sent = []

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        sent.append(message)

    await app({"type": "lifespan"}, receive, send)
    assert sent[0] == {"type": "lifespan.startup.failed", "message": "SettingsError: AI_PROVIDER"}


async def run_startup(monkeypatch, *, build_error):
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    closed = []

    async def aclose():
        closed.append(True)

    async def fake_open_state(_url):
        return object(), object(), aclose

    def failing_build(_settings):
        raise build_error

    monkeypatch.setattr(service, "open_state", fake_open_state)
    monkeypatch.setattr(service, "build_chat_model", failing_build)
    sent = []

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        sent.append(message)

    await EnvApp()({"type": "lifespan"}, receive, send)
    return sent, closed


async def test_startup_failure_names_only_the_error_class_and_closes_the_pool(monkeypatch):
    sent, closed = await run_startup(monkeypatch, build_error=RuntimeError("could not connect postgresql://u:pw@h/db sk-secret"))
    assert sent == [{"type": "lifespan.startup.failed", "message": "RuntimeError"}]
    assert closed == [True]


async def test_cleanup_failure_prints_only_the_error_class(monkeypatch, capsys):
    from webvue_ai_service import cleanup

    async def failing_open_state(_url):
        raise RuntimeError("could not connect postgresql://u:pw@h/db sk-secret")

    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://u:pw@h/db")
    monkeypatch.setattr(cleanup, "open_state", failing_open_state)
    assert await cleanup.main() == 1
    captured = capsys.readouterr()
    assert "RuntimeError" in captured.err
    for secret in ("u:pw@h", "sk-secret", "postgresql://"):
        assert secret not in captured.out + captured.err


async def test_shutdown_waits_for_the_persist_tasks_before_closing_the_pool(monkeypatch):
    from tests.fakes import ScriptedChatModel
    from webvue_ai_service.store import MemoryRunStore

    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    order = []

    async def aclose():
        order.append("pool closed")

    async def fake_open_state(_url):
        from langgraph.checkpoint.memory import InMemorySaver

        return MemoryRunStore(), InMemorySaver(), aclose

    monkeypatch.setattr(service, "open_state", fake_open_state)
    monkeypatch.setattr(service, "build_chat_model", lambda _settings: ScriptedChatModel([]))
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
    assert order == ["drained", "pool closed"]


async def start_env_app():
    app, sent, queue = EnvApp(), [], [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]

    async def receive():
        return queue.pop(0)

    async def send(message):
        sent.append(message)

    await app({"type": "lifespan"}, receive, send)
    return sent


async def test_boot_without_a_database_fails_unless_memory_state_is_allowed(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_ALLOW_MEMORY_STATE", raising=False)
    assert await start_env_app() == [{"type": "lifespan.startup.failed", "message": "SettingsError: AI_DATABASE_URL"}]


async def test_memory_boot_warns_once_about_state_and_about_the_missing_token_without_secrets(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="webvue_ai_service")
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    assert (await start_env_app())[0] == {"type": "lifespan.startup.complete"}
    texts = [record.getMessage() for record in caplog.records]
    assert sum("memory" in text for text in texts) == 1 and sum("AI_SERVICE_TOKEN" in text for text in texts) == 1


async def test_a_database_and_a_token_boot_without_warnings(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="webvue_ai_service")
    monkeypatch.setenv("AI_PROVIDER", "ollama")
    monkeypatch.setenv("AI_MODEL", "m")
    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://u:pw@h/db")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "t" * 30)

    async def fake_open_state(_url):
        from langgraph.checkpoint.memory import InMemorySaver

        async def aclose():
            return None

        return MemoryRunStore(), InMemorySaver(), aclose

    monkeypatch.setattr(service, "open_state", fake_open_state)
    assert (await start_env_app())[0] == {"type": "lifespan.startup.complete"}
    assert caplog.records == []
