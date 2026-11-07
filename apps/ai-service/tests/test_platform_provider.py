"""The platform provider file: what it must hold, how it is rebuilt when it changes, and what the proxy is told."""
import asyncio
import json
import logging

import pytest

from liwan_ai_service import platform_provider
from liwan_ai_service.control import MemoryControlState
from liwan_ai_service.platform_provider import (
    PlatformProvider,
    PlatformProviderError,
    open_platform_model,
    parse_platform_provider,
    watch_platform_provider,
)
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.service import create_app
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, Settings, SettingsError
from liwan_ai_service.tenant_egress import TenantEgress, platform_host
from tests.fakes import ScriptedChatModel, SeededStates, ai_text, platform_of
from tests.platform_file import platform_env, write_platform_file

KEY = "sk-platform-secret-0123456789"


def raw(**fields) -> bytes:
    body = {"provider": "openai", "model": "gpt-4o", "api_key": KEY, "revision": 3, **fields}
    return json.dumps({name: value for name, value in body.items() if value is not None}).encode()


def test_a_sound_file_names_the_platform_provider():
    assert parse_platform_provider(raw()) == PlatformProvider("openai", "gpt-4o", None, KEY, 3)
    assert parse_platform_provider(raw(provider="openai_compatible", base_url="https://api.deepseek.com/v1")).base_url == "https://api.deepseek.com/v1"
    local = parse_platform_provider(raw(provider="ollama", api_key=None, base_url="http://ollama:11434"))
    assert local == PlatformProvider("ollama", "gpt-4o", "http://ollama:11434", None, 3)


def test_stream_usage_is_optional_and_explicit_when_given():
    assert parse_platform_provider(raw()).stream_usage is None
    assert parse_platform_provider(raw(provider="openai_compatible", base_url="https://api.deepseek.com/v1", stream_usage=True)).stream_usage is True
    assert parse_platform_provider(raw(provider="openai_compatible", base_url="https://llm.example.com/v1", stream_usage=False)).stream_usage is False


def test_anthropic_ignores_a_base_url_as_the_service_always_has():
    assert parse_platform_provider(raw(provider="anthropic", base_url="https://elsewhere.example/v1")).base_url is None


@pytest.mark.parametrize(("body", "reason"), [
    (b"not json", "is not JSON"),
    (b"[]", "must be a JSON object"),
    (raw(provider="gemini"), "provider: must be one of"),
    (raw(provider=None), "provider: is required"),
    (raw(model=None), "model: is required"),
    (raw(model="a\nb"), "model: must be 1 to 128"),
    (raw(model="x" * 129), "model: must be 1 to 128"),
    (raw(api_key=None), "api_key: is required"),
    (raw(provider="openai_compatible"), "base_url: is required"),
    (raw(provider="openai_compatible", base_url="ftp://llm.example.com"), "base_url: must be an http(s) URL"),
    (raw(provider="openai_compatible", base_url="https://user:pw@llm.example.com/v1"), "base_url: must be an http(s) URL"),
    (raw(provider="openai_compatible", base_url="https://llm.example.com/v1?key=1"), "base_url: must be an http(s) URL"),
    (raw(base_url="https://llm.example.com:99999/v1"), "base_url: must be an http(s) URL"),
    (raw(stream_usage="yes"), "stream_usage: must be true or false"),
    (raw(stream_usage=1), "stream_usage: must be true or false"),
    (raw(revision=0), "revision: must be an integer from 1"),
    (raw(revision="3"), "revision: must be an integer from 1"),
    (raw(revision=None), "revision: must be an integer from 1"),
    (raw(apikey="typo"), "apikey: has an unknown field"),
])
def test_a_bad_file_is_rejected_by_reason_and_never_echoes_a_value(body, reason):
    with pytest.raises(PlatformProviderError) as error:
        parse_platform_provider(body)
    assert reason in error.value.reason and KEY not in str(error.value) + error.value.reason
    assert isinstance(error.value, SettingsError) and error.value.variable.startswith(PLATFORM_PROVIDER_FILE)


def test_a_key_is_needed_exactly_for_providers_that_need_one():
    for name, spec in REGISTRY.items():
        extra = {"base_url": "https://llm.example.com/v1"} if spec.needs_base_url else {}
        if spec.needs_api_key:
            with pytest.raises(PlatformProviderError):
                parse_platform_provider(raw(provider=name, api_key=None, **extra))
        else:
            assert parse_platform_provider(raw(provider=name, api_key=None, **extra)).api_key is None


def settings_for(path):
    return Settings.from_env({PLATFORM_PROVIDER_FILE: str(path), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})


def test_start_fails_clearly_when_the_file_is_missing_or_invalid(tmp_path):
    with pytest.raises(PlatformProviderError) as missing:
        open_platform_model(settings_for(tmp_path / "absent.json"))
    assert missing.value.variable == PLATFORM_PROVIDER_FILE and missing.value.reason == "unreadable"
    bad = tmp_path / "bad.json"
    bad.write_text('{"provider": "openai", "model": "m", "revision": 1}')
    with pytest.raises(PlatformProviderError) as invalid:
        open_platform_model(settings_for(bad))
    assert invalid.value.variable == f"{PLATFORM_PROVIDER_FILE}.api_key"


def test_start_builds_the_endpoint_with_the_token_count_choice_of_the_file(tmp_path):
    for choice, expected in ((True, True), (False, False), (None, False)):
        path = write_platform_file(tmp_path / f"p{choice}.json", "openai_compatible", "m", api_key=KEY, base_url="https://llm.example.com/v1", stream_usage=choice)
        assert open_platform_model(settings_for(path)).current.run_model.model.stream_usage is expected


def test_start_builds_the_model_the_file_names(tmp_path):
    path = write_platform_file(tmp_path / "p.json", "openai_compatible", "deepseek-chat", api_key=KEY, base_url="https://api.deepseek.com/v1", revision=7)
    platform = open_platform_model(settings_for(path))
    current = platform.current
    assert (current.provider.revision, current.run_model.identity.provider, current.run_model.identity.model) == (7, "openai_compatible", "deepseek-chat")
    assert current.run_model.model.openai_api_base == "https://api.deepseek.com/v1" and platform.secrets == (KEY,)


async def wait_for(condition, seconds=5):
    for _ in range(int(seconds / 0.01)):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the watcher did not get there")


async def test_a_valid_change_replaces_the_model_and_an_invalid_one_keeps_the_last_valid_and_is_logged_without_the_key(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="liwan_ai_service")
    path = write_platform_file(tmp_path / "p.json", "openai", "gpt-4o", api_key=KEY, revision=1)
    settings = settings_for(path)
    platform = open_platform_model(settings)
    first = platform.current
    changes = []

    async def on_change(provider):
        changes.append(provider.revision)

    watcher = asyncio.create_task(watch_platform_provider(platform, settings, on_change, interval=0.01))
    try:
        path.write_text('{"provider": "openai", "model": "gpt-4o", "api_key": "' + KEY + '", "revision": 0}')
        await wait_for(lambda: any("rejected" in record.getMessage() for record in caplog.records))
        assert platform.current is first and changes == []
        assert KEY not in caplog.text
        rejected = len([r for r in caplog.records if "rejected" in r.getMessage()])
        await asyncio.sleep(0.1)
        assert len([r for r in caplog.records if "rejected" in r.getMessage()]) == rejected  # the same content is logged once

        newer = "sk-newer-key-0123456789"
        write_platform_file(path, "anthropic", "claude-x", api_key=newer, revision=2)
        await wait_for(lambda: changes == [2])
        assert (platform.current.provider.provider, platform.current.run_model.identity.model) == ("anthropic", "claude-x")
        assert first.run_model.identity.model == "gpt-4o"  # a run that already started keeps the model it began on
        assert set(platform.secrets) == {KEY, newer}  # a late log line of the old key is still redacted
        assert newer not in caplog.text

        path.unlink()
        await wait_for(lambda: any("not read" in record.getMessage() for record in caplog.records))
        assert platform.current.provider.revision == 2
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def test_a_model_the_sdk_cannot_build_is_rejected_like_an_invalid_file(tmp_path, caplog, monkeypatch):
    path = write_platform_file(tmp_path / "p.json", "openai", "gpt-4o", api_key=KEY, revision=1)
    settings = settings_for(path)
    platform = open_platform_model(settings)

    def refuse(*_args):
        raise RuntimeError(f"sdk refused {KEY}")

    monkeypatch.setattr(platform_provider, "build_platform_model", refuse)
    watcher = asyncio.create_task(watch_platform_provider(platform, settings, lambda _p: asyncio.sleep(0), interval=0.01))
    try:
        write_platform_file(path, "openai", "gpt-5", api_key=KEY, revision=2)
        await wait_for(lambda: any("could not be built: RuntimeError" in record.getMessage() for record in caplog.records))
        assert platform.current.provider.revision == 1 and KEY not in caplog.text
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


@pytest.mark.parametrize(("provider", "base_url", "host"), [
    ("openai", None, "api.openai.com"),
    ("anthropic", None, "api.anthropic.com"),
    ("openrouter", None, "openrouter.ai"),
    ("openai_compatible", "https://api.deepseek.com/v1", "api.deepseek.com"),
    ("openai", "https://Proxy.Example.com/v1", "proxy.example.com"),
    ("ollama", "http://ollama:11434", None),  # an internal endpoint is an explicit AI_EGRESS_HOSTS entry
    ("ollama", None, None),
    ("openai_compatible", "https://llm:8443/v1", None),
])
def test_only_a_public_host_is_published_for_the_platform_provider(provider, base_url, host):
    assert platform_host(provider, base_url) == host


async def test_the_platform_host_file_is_published_and_survives_the_tenant_orphan_sweep(tmp_path):
    egress = TenantEgress(str(tmp_path))
    await egress.publish_platform("api.deepseek.com")
    await egress.publish("acme_db", "api.openai.com")
    assert (tmp_path / "platform.hosts").read_text() == "api.deepseek.com\n"
    await asyncio.to_thread(egress._remove_orphans, {"acme_db"})
    assert (tmp_path / "platform.hosts").exists()
    await egress.publish_platform(None)
    assert not (tmp_path / "platform.hosts").exists()
    with pytest.raises(ValueError, match="reserved"):
        await egress.publish("platform", "api.openai.com")


async def test_the_service_publishes_the_platform_host_at_start(tmp_path):
    settings = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true", "AI_TENANT_EGRESS_DIR": str(tmp_path)})
    app = create_app(platform_of(ScriptedChatModel([ai_text("x")]), "openai", "gpt-4o", KEY), SeededStates(), MemoryControlState(), settings)
    await app.state.sync_egress()
    assert (tmp_path / "platform.hosts").read_text() == "api.openai.com\n"
