"""The platform provider file: what it must hold, how it is rebuilt when it changes, and what the proxy is told."""
import asyncio
import copy
import json
import logging

import httpx
import pytest
from pydantic import ValidationError

from liwan_ai_service import platform_provider
from liwan_ai_service.contracts import Policy
from liwan_ai_service.control import MemoryControlState
from liwan_ai_service.platform_provider import (
    QUALITIES,
    PlatformActive,
    PlatformModel,
    PlatformModelEntry,
    PlatformProvider,
    PlatformProviderError,
    build_active,
    open_platform_model,
    parse_platform_config,
    watch_platform_provider,
)
from liwan_ai_service.provider_registry import REGISTRY
from liwan_ai_service.routing import RunModels
from liwan_ai_service.service import create_app
from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, Settings, SettingsError
from liwan_ai_service.tenant_egress import TenantEgress, platform_host, platform_hosts
from liwan_ai_service.usage import ModelIdentity, RunModel, price_units
from tests.fakes import PLATFORM_POLICY, ScriptedChatModel, SeededStates, ai_text, ai_usage, new_id
from tests.platform_file import platform_body, platform_env, write_platform_file, write_platform_json
from tests.test_service import BODY, HEADERS, parse_sse
from tests.test_service import SETTINGS as SERVICE_SETTINGS

KEY = "sk-platform-secret-0123456789"
OTHER_KEY = "second-provider-test-key"


def full() -> dict:
    """A file with two providers, three models (one priced) and a map that uses all three quality levels."""
    return {
        "revision": 4,
        "margin_bps": 2000,
        "providers": {
            "oai": {"provider": "openai", "api_key": KEY},
            "ds": {"provider": "openai_compatible", "base_url": "https://api.deepseek.com/v1", "api_key": OTHER_KEY, "stream_usage": True},
        },
        "models": {
            "mid": {"provider": "oai", "model": "gpt-4o", "input_price": "2.5", "cached_input_price": "1.25", "output_price": "10"},
            "cheap": {"provider": "ds", "model": "deepseek-chat", "input_price": "0.14", "output_price": "0.28"},
            "big": {"provider": "oai", "model": "gpt-5"},
        },
        "routes": {
            "default": "mid",
            "balanced": {"quick": "cheap", "analysis": "big"},
            "economical": {"standard": "cheap", "analysis": "cheap"},
            "best": {"standard": "big", "writing": "big"},
        },
    }


def raw(body: dict | None = None, **top) -> bytes:
    body = copy.deepcopy(body or full())
    body.update(top)
    return json.dumps({name: value for name, value in body.items() if value is not None}).encode()


def edited(edit) -> bytes:
    body = full()
    edit(body)
    return raw(body)


def test_a_sound_file_names_providers_prices_and_routes():
    config = parse_platform_config(raw())
    assert (config.revision, config.margin_bps, config.default, dict(config.dropped)) == (4, 2000, "mid", {})
    assert config.providers["oai"] == PlatformProvider("openai", None, KEY)
    assert config.providers["ds"] == PlatformProvider("openai_compatible", "https://api.deepseek.com/v1", OTHER_KEY, True)
    assert config.models["mid"] == PlatformModelEntry("oai", "gpt-4o", 250_000, 125_000, 1_000_000)
    assert config.models["cheap"] == PlatformModelEntry("ds", "deepseek-chat", 14_000, None, 28_000)
    assert config.models["big"] == PlatformModelEntry("oai", "gpt-5")
    assert config.routes["best"] == {"standard": "big", "writing": "big"}


def test_a_single_model_file_is_valid_and_every_capability_falls_to_the_default():
    config = parse_platform_config(json.dumps(platform_body("openai", "gpt-4o", api_key=KEY)).encode())
    assert config.default == "main" and config.routes == {}
    settings = SETTINGS
    for models in build_active(settings, config).quality.values():
        assert not models.can_route and {models.for_capability(c).identity.model for c in ("quick", "analysis")} == {"gpt-4o"}


def test_anthropic_ignores_a_base_url_as_the_service_always_has():
    body = platform_body("anthropic", "claude-x", api_key=KEY, base_url="https://elsewhere.example/v1")
    assert parse_platform_config(json.dumps(body).encode()).providers["main"].base_url is None


@pytest.mark.parametrize(("edit", "reason"), [
    (lambda b: b.update(extra=1), "extra: has an unknown field"),
    (lambda b: b["providers"]["oai"].update(apikey="typo"), "providers.oai.apikey: has an unknown field"),
    (lambda b: b["models"]["mid"].update(price="1"), "models.mid.price: has an unknown field"),
    (lambda b: b["routes"].update(fast={}), "routes.fast: has an unknown field"),
    (lambda b: b["routes"]["best"].update(translation="mid"), "routes.best.translation: has an unknown field"),
    (lambda b: b["routes"]["best"].update(standard=7), "routes.best.standard: must be a model id"),
    (lambda b: b["routes"].update(best=["mid"]), "routes.best: must be a JSON object"),
    (lambda b: b.update(providers={}), "providers: must be a JSON object with at least one entry"),
    (lambda b: b.update(providers=[]), "providers: must be a JSON object with at least one entry"),
    (lambda b: b["models"].update({"Bad Id": {"provider": "oai", "model": "m"}}), "models: has an id"),
    (lambda b: b["providers"].update(oai=[]), "providers.oai: must be a JSON object"),
    (lambda b: b.update(revision=0), "revision: must be an integer from 1"),
    (lambda b: b.update(revision="3"), "revision: must be an integer from 1"),
    (lambda b: b.pop("revision"), "revision: must be an integer from 1"),
    (lambda b: b.update(margin_bps=-1), "margin_bps: must be an integer from 0 to 10000"),
    (lambda b: b.update(margin_bps=10001), "margin_bps: must be an integer from 0 to 10000"),
    (lambda b: b.update(margin_bps=True), "margin_bps: must be an integer from 0 to 10000"),
    (lambda b: b.pop("margin_bps"), "margin_bps: must be an integer from 0 to 10000"),
    (lambda b: b["routes"].pop("default"), "routes.default: is required"),
    (lambda b: b["routes"].update(default="nope"), "routes.default: the default model nope is unusable"),
    (lambda b: b["routes"].update(default="BAD ID"), "routes.default: must be a model id"),
    (lambda b: b.pop("routes"), "routes: must be a JSON object"),
])
def test_a_structural_error_rejects_the_file_by_reason_and_never_echoes_a_value(edit, reason):
    with pytest.raises(PlatformProviderError) as error:
        parse_platform_config(edited(edit))
    assert reason in error.value.reason and KEY not in str(error.value) + error.value.reason
    assert isinstance(error.value, SettingsError) and error.value.variable.startswith(PLATFORM_PROVIDER_FILE)


@pytest.mark.parametrize(("body", "reason"), [
    (b"not json", "is not JSON"),
    (b"[]", "must be a JSON object"),
])
def test_a_file_that_is_not_an_object_is_rejected(body, reason):
    with pytest.raises(PlatformProviderError) as error:
        parse_platform_config(body)
    assert reason in error.value.reason


@pytest.mark.parametrize(("edit", "reason"), [
    (lambda b: b["providers"]["oai"].update(provider="gemini"), "providers.oai.provider: must be one of"),
    (lambda b: b["providers"]["oai"].pop("api_key"), "providers.oai.api_key: is required"),
    (lambda b: b["providers"]["oai"].update(base_url="ftp://llm.example.com"), "providers.oai.base_url: must be an http(s) URL"),
    (lambda b: b["providers"]["oai"].update(base_url="https://user:pw@llm.example.com/v1"), "providers.oai.base_url: must be an http(s) URL"),
    (lambda b: b["providers"]["oai"].update(base_url="https://llm.example.com/v1?key=1"), "providers.oai.base_url: must be an http(s) URL"),
    (lambda b: b["providers"]["oai"].update(base_url="https://llm.example.com:99999/v1"), "providers.oai.base_url: must be an http(s) URL"),
    (lambda b: b["providers"]["oai"].update(stream_usage="yes"), "providers.oai.stream_usage: must be true or false"),
    (lambda b: b["providers"]["ds"].pop("base_url"), "providers.ds.base_url: is required"),
])
def test_a_provider_that_is_invalid_makes_its_models_unusable_and_the_default_on_it_rejects_the_file(edit, reason):
    body = full()
    edit(body)
    with pytest.raises(PlatformProviderError) as error:
        parse_platform_config(raw(body, routes={"default": "mid" if "oai" in reason else "cheap"}))
    assert reason in error.value.reason and "unusable" in error.value.reason and KEY not in error.value.reason


def test_a_key_is_needed_exactly_for_providers_that_need_one():
    for name, spec in REGISTRY.items():
        extra = {"base_url": "https://llm.example.com/v1"} if spec.needs_base_url else {}
        keyless = platform_body(name, "m", api_key=None, **extra)
        if spec.needs_api_key:
            with pytest.raises(PlatformProviderError):
                parse_platform_config(json.dumps(keyless).encode())
        else:
            assert parse_platform_config(json.dumps(keyless).encode()).providers["main"].api_key is None


@pytest.mark.parametrize(("edit", "reason"), [
    (lambda b: b["models"]["big"].update(provider="ghost"), "models.big.provider: is not a provider of the file"),
    (lambda b: b["models"]["big"].update(provider=None), "models.big.provider: is required"),
    (lambda b: b["models"]["big"].update(model="a\nb"), "models.big.model: must be 1 to 128"),
    (lambda b: b["models"]["big"].update(model="x" * 129), "models.big.model: must be 1 to 128"),
    (lambda b: b["models"]["big"].pop("model"), "models.big.model: is required"),
    (lambda b: b["models"]["big"].update(input_price="0.000001"), "models.big.input_price: a price has at most five decimal places"),
    (lambda b: b["models"]["big"].update(output_price="-1"), "models.big.output_price: a price is a plain decimal"),
    (lambda b: b["models"]["big"].update(output_price="1e3"), "models.big.output_price: a price is a plain decimal"),
    (lambda b: b["models"]["big"].update(cached_input_price=3), "models.big.cached_input_price: a price is a plain decimal"),
    (lambda b: b["models"]["big"].update(input_price="99999.99999"), "models.big.input_price: a price is above the shared maximum"),
])
def test_one_invalid_model_is_dropped_with_a_reason_and_its_routes_fall_back(edit, reason, caplog):
    config = parse_platform_config(edited(edit))
    assert set(config.models) == {"mid", "cheap"} and reason in config.dropped["big"]
    caplog.set_level(logging.WARNING)
    active = build_active(SETTINGS, config)
    # `big` served balanced analysis and both best cells: each falls to the balanced cell and then to the default
    assert active.quality["balanced"].for_capability("analysis").identity.model == "gpt-4o"
    assert active.quality["best"].for_capability("standard").identity.model == "gpt-4o"
    assert active.quality["best"].for_capability("writing").identity.model == "gpt-4o"
    assert active.quality["balanced"].for_capability("quick").identity.model == "deepseek-chat"  # an untouched route still works
    assert "platform model big dropped" in caplog.text and KEY not in caplog.text and OTHER_KEY not in caplog.text


def test_prices_convert_to_exact_cost_units_per_million_tokens():
    assert [price_units(p) for p in ("0", "3", "0.1", "0.00001", "2.50", "10", "0.15")] == [0, 300_000, 10_000, 1, 250_000, 1_000_000, 15_000]
    for bad in ("0.000001", "1.234567", "", ".5", "5.", "-1", "1e3", "NaN", " 1", "21474.83648", "9999999999"):
        with pytest.raises(ValueError):
            price_units(bad)
    assert price_units("21474.83647") == 2_147_483_647
    with pytest.raises(ValueError):
        price_units(3)  # type: ignore[arg-type]


def test_the_model_map_decides_per_quality_level_with_the_cell_then_balanced_then_default_fallback():
    active = build_active(SETTINGS, parse_platform_config(raw()))

    def served(quality):
        models = active.quality[quality]
        return {c: models.for_capability(c).identity.model for c in ("quick", "standard", "analysis", "writing")}

    assert served("balanced") == {"quick": "deepseek-chat", "standard": "gpt-4o", "analysis": "gpt-5", "writing": "gpt-4o"}
    assert served("economical") == {"quick": "deepseek-chat", "standard": "deepseek-chat", "analysis": "deepseek-chat", "writing": "gpt-4o"}
    assert served("best") == {"quick": "deepseek-chat", "standard": "gpt-5", "analysis": "gpt-5", "writing": "gpt-5"}
    assert all(models.can_route for models in active.quality.values()) and active.default.model == "gpt-4o"


def test_a_mapped_model_carries_its_capability_prices_and_the_margin():
    models = build_active(SETTINGS, parse_platform_config(raw())).quality["balanced"]
    cheap = models.for_capability("quick").identity
    assert (cheap.provider, cheap.model, cheap.billing, cheap.capability) == ("openai_compatible", "deepseek-chat", "platform", "quick")
    assert (cheap.input_units, cheap.cached_input_units, cheap.output_units, cheap.margin_bps) == (14_000, None, 28_000, 2000)
    mid = models.for_capability("standard").identity
    assert (mid.capability, mid.input_units, mid.cached_input_units, mid.output_units, mid.margin_bps) == ("standard", 250_000, 125_000, 1_000_000, 2000)
    assert models.for_capability("analysis").identity.input_units is None  # `big` has no price: its calls report tokens and no cost
    assert models.default.identity.capability == "standard" and models.for_capability("quick").model is not models.for_capability("standard").model


def test_a_model_is_built_once_and_shared_by_every_capability_that_routes_to_it():
    models = build_active(SETTINGS, parse_platform_config(raw())).quality["economical"]
    assert models.for_capability("standard").model is models.for_capability("analysis").model is models.for_capability("quick").model


SETTINGS = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})


def settings_for(path):
    return Settings.from_env({PLATFORM_PROVIDER_FILE: str(path), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})


def test_start_fails_clearly_when_the_file_is_missing_or_invalid(tmp_path):
    with pytest.raises(PlatformProviderError) as missing:
        open_platform_model(settings_for(tmp_path / "absent.json"))
    assert missing.value.variable == PLATFORM_PROVIDER_FILE and missing.value.reason == "unreadable"
    bad = write_platform_file(tmp_path / "bad.json", "openai", "m", api_key=None)
    with pytest.raises(PlatformProviderError) as invalid:
        open_platform_model(settings_for(bad))
    assert invalid.value.variable == f"{PLATFORM_PROVIDER_FILE}.routes.default"
    assert "providers.main.api_key: is required for this provider" in invalid.value.reason  # the reason names the root cause


def test_start_builds_the_endpoint_with_the_token_count_choice_of_the_file(tmp_path):
    for choice, expected in ((True, True), (False, False), (None, False)):
        path = write_platform_file(tmp_path / f"p{choice}.json", "openai_compatible", "m", api_key=KEY, base_url="https://llm.example.com/v1", stream_usage=choice)
        assert open_platform_model(settings_for(path)).current.quality["balanced"].default.model.stream_usage is expected


def test_start_builds_the_models_the_file_names(tmp_path):
    path = write_platform_file(tmp_path / "p.json", "openai_compatible", "deepseek-chat", api_key=KEY, base_url="https://api.deepseek.com/v1", revision=7)
    platform = open_platform_model(settings_for(path))
    default = platform.current.quality["balanced"].default
    assert (platform.current.revision, default.identity.provider, default.identity.model) == (7, "openai_compatible", "deepseek-chat")
    assert default.model.openai_api_base == "https://api.deepseek.com/v1" and platform.secrets == (KEY,)
    assert platform.current.hosts == ("api.deepseek.com",)


def test_a_file_with_several_models_starts_with_every_model_the_routes_name(tmp_path):
    path = write_platform_json(tmp_path / "p.json", full())
    platform = open_platform_model(settings_for(path))
    assert set(platform.secrets) == {KEY, OTHER_KEY} and platform.current.hosts == ("api.deepseek.com", "api.openai.com")
    assert platform.current.quality["best"].for_capability("writing").identity.model == "gpt-5"


async def wait_for(condition, seconds=5):
    for _ in range(int(seconds / 0.01)):
        if condition():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the watcher did not get there")


async def test_a_valid_change_replaces_the_models_and_an_invalid_one_keeps_the_last_valid_and_is_logged_without_the_key(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="liwan_ai_service")
    path = write_platform_file(tmp_path / "p.json", "openai", "gpt-4o", api_key=KEY, revision=1)
    settings = settings_for(path)
    platform = open_platform_model(settings)
    first = platform.current
    changes = []

    async def on_change(active):
        changes.append(active.revision)

    watcher = asyncio.create_task(watch_platform_provider(platform, settings, on_change, interval=0.01))
    try:
        write_platform_file(path, "openai", "gpt-4o", api_key=KEY, revision=0)
        await wait_for(lambda: any("rejected" in record.getMessage() for record in caplog.records))
        assert platform.current is first and changes == []
        assert KEY not in caplog.text
        rejected = len([r for r in caplog.records if "rejected" in r.getMessage()])
        await asyncio.sleep(0.1)
        assert len([r for r in caplog.records if "rejected" in r.getMessage()]) == rejected  # the same content is logged once

        newer = "sk-newer-key-0123456789"
        write_platform_file(path, "anthropic", "claude-x", api_key=newer, revision=2)
        await wait_for(lambda: changes == [2])
        assert (platform.current.default.provider, platform.current.default.model) == ("anthropic", "claude-x")
        assert first.default.model == "gpt-4o"  # a run that already started keeps the models it began on
        assert set(platform.secrets) == {KEY, newer}  # a late log line of the old key is still redacted
        assert newer not in caplog.text

        path.unlink()
        await wait_for(lambda: any("not read" in record.getMessage() for record in caplog.records))
        assert platform.current.revision == 2
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def test_a_bad_default_is_rejected_and_the_last_valid_configuration_stays(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="liwan_ai_service")
    path = write_platform_json(tmp_path / "p.json", full())
    settings = settings_for(path)
    platform = open_platform_model(settings)
    first = platform.current
    watcher = asyncio.create_task(watch_platform_provider(platform, settings, lambda _a: asyncio.sleep(0), interval=0.01))
    try:
        body = full()
        body["revision"] = 5
        body["models"]["mid"]["input_price"] = "0.000001"  # the default model's price is invalid: the default is unusable
        write_platform_json(path, body)
        await wait_for(lambda: any("rejected" in record.getMessage() for record in caplog.records))
        assert platform.current is first and "the default model mid is unusable" in caplog.text
        assert KEY not in caplog.text and OTHER_KEY not in caplog.text
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def test_a_dropped_model_does_not_stop_a_reload(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="liwan_ai_service")
    path = write_platform_json(tmp_path / "p.json", full())
    settings = settings_for(path)
    platform = open_platform_model(settings)
    changes = []

    async def on_change(active):
        changes.append(active.revision)

    watcher = asyncio.create_task(watch_platform_provider(platform, settings, on_change, interval=0.01))
    try:
        body = full()
        body["revision"] = 5
        body["models"]["big"]["output_price"] = "oops"
        write_platform_json(path, body)
        await wait_for(lambda: changes == [5])
        assert platform.current.quality["best"].for_capability("writing").identity.model == "gpt-4o"
        assert "platform model big dropped" in caplog.text
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


async def test_a_model_the_sdk_cannot_build_is_dropped_and_an_unbuildable_default_rejects_the_file(tmp_path, caplog, monkeypatch):
    path = write_platform_json(tmp_path / "p.json", full())
    settings = settings_for(path)
    platform = open_platform_model(settings)
    built = platform_provider.build_platform_model

    def refuse_gpt5(provider, config, model):
        if model == "gpt-5":
            raise RuntimeError(f"sdk refused {KEY}")
        return built(provider, config, model)

    def refuse_all(*_args):
        raise RuntimeError(f"sdk refused {KEY}")

    monkeypatch.setattr(platform_provider, "build_platform_model", refuse_gpt5)
    caplog.set_level(logging.INFO, logger="liwan_ai_service")
    watcher = asyncio.create_task(watch_platform_provider(platform, settings, lambda _p: asyncio.sleep(0), interval=0.01))
    try:
        body = full()
        body["revision"] = 5
        write_platform_json(path, body)
        await wait_for(lambda: platform.current.revision == 5)
        assert platform.current.quality["best"].for_capability("standard").identity.model == "gpt-4o"
        assert "platform model big dropped: could not be built: RuntimeError" in caplog.text

        monkeypatch.setattr(platform_provider, "build_platform_model", refuse_all)
        body["revision"] = 6
        write_platform_json(path, body)
        await wait_for(lambda: any("the default model mid is unusable: could not be built: RuntimeError" in r.getMessage() for r in caplog.records))
        assert platform.current.revision == 5 and KEY not in caplog.text
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


def test_the_hosts_of_all_providers_are_listed_once_and_sorted():
    assert platform_hosts([("openai", None), ("openai_compatible", "https://api.deepseek.com/v1"), ("openai", None), ("ollama", "http://ollama:11434")]) == (
        "api.deepseek.com", "api.openai.com",
    )
    assert platform_hosts([("ollama", None)]) == ()


async def test_the_platform_host_file_is_published_and_survives_the_tenant_orphan_sweep(tmp_path):
    egress = TenantEgress(str(tmp_path))
    await egress.publish_platform(["api.deepseek.com", "api.openai.com"])
    await egress.publish("acme_db", "api.openai.com")
    assert (tmp_path / "platform.hosts").read_text() == "api.deepseek.com\napi.openai.com\n"
    assert (tmp_path / "acme_db.hosts").read_text() == "api.openai.com\n"
    await asyncio.to_thread(egress._remove_orphans, {"acme_db"})
    assert (tmp_path / "platform.hosts").exists()
    await egress.publish_platform([])
    assert not (tmp_path / "platform.hosts").exists()
    with pytest.raises(ValueError, match="reserved"):
        await egress.publish("platform", "api.openai.com")


async def test_the_service_publishes_the_hosts_of_all_platform_providers_at_start(tmp_path):
    directory = tmp_path / "hosts"
    directory.mkdir()
    path = write_platform_json(tmp_path / "p.json", full())
    settings = Settings.from_env({PLATFORM_PROVIDER_FILE: str(path), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true", "AI_TENANT_EGRESS_DIR": str(directory)})
    app = create_app(open_platform_model(settings), SeededStates(), MemoryControlState(), settings)
    await app.state.sync_egress()
    assert (directory / "platform.hosts").read_text() == "api.deepseek.com\napi.openai.com\n"


async def test_a_single_provider_file_publishes_one_host(tmp_path):
    path = write_platform_file(tmp_path / "p.json", "openai", "gpt-4o", api_key=KEY)
    settings = Settings.from_env({PLATFORM_PROVIDER_FILE: str(path), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true", "AI_TENANT_EGRESS_DIR": str(tmp_path)})
    app = create_app(open_platform_model(settings), SeededStates(), MemoryControlState(), settings)
    await app.state.sync_egress()
    assert (tmp_path / "platform.hosts").read_text() == "api.openai.com\n"


def policy_models(answering, response):
    """One scripted model per quality level, each priced differently, as the platform file would map them; only ``answering`` can answer."""
    scripted = {quality: ScriptedChatModel([response] if quality == answering else []) for quality in QUALITIES}
    prices = {"economical": (100_000, 200_000), "balanced": (300_000, 1_500_000), "best": (1_500_000, 7_500_000)}
    quality = {
        level: RunModels(RunModel(scripted[level], ModelIdentity("openai", f"{level}-model", "platform", "standard", *prices[level], 2000)))
        for level in QUALITIES
    }
    return scripted, PlatformModel(PlatformActive(1, quality, (), frozenset()))


async def test_the_run_policy_picks_the_quality_level_and_defaults_to_balanced():
    seen = {}
    for policy, expected in (({}, "balanced"), ({"quality": "economical"}, "economical"), ({"quality": "best"}, "best")):
        scripted, platform = policy_models(expected, ai_usage(ai_text("hello"), 1000, 100))
        app = create_app(platform, SeededStates(), MemoryControlState(), SERVICE_SETTINGS)
        body = {**BODY, "policy": {**PLATFORM_POLICY, **policy}, "new_run_id": new_id()}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
            events = parse_sse((await client.post("/v1/runs", json=body, headers=HEADERS)).text)
        assert events[-1][1] == {"status": "done"}
        seen[expected] = [name for name, model in scripted.items() if model.calls]
        calls = [data for name, data in events if name == "model_call"]
        usage = [data for name, data in events if name == "model_usage"]
        assert {call["model"] for call in calls} == {f"{expected}-model"}
        assert usage[0]["cost"] is not None and usage[0]["charge"] == -(-usage[0]["cost"] * 12000 // 10000)  # priced by its own level, margin on top
    assert seen == {"balanced": ["balanced"], "economical": ["economical"], "best": ["best"]}


async def test_a_setup_run_uses_the_balanced_quick_model_whatever_the_quality():
    scripted, platform = policy_models("balanced", ai_text("ok"))
    app = create_app(platform, SeededStates(), MemoryControlState(), SERVICE_SETTINGS)
    body = {**BODY, "policy": {**PLATFORM_POLICY, "provider_mode": "setup", "quality": "best"}, "new_run_id": new_id()}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
        events = parse_sse((await client.post("/v1/runs", json=body, headers=HEADERS)).text)
    assert [name for name, model in scripted.items() if model.calls] == ["balanced"]
    assert all(data["billing"] == "setup" for name, data in events if name == "model_call")
    assert all(data["charge"] is None for name, data in events if name == "model_usage")


def test_a_quality_level_outside_the_three_is_refused_by_the_contract():
    assert Policy(provider_mode="platform", consent_signed=True, max_output_tokens=None).quality == "balanced"
    with pytest.raises(ValidationError):
        Policy(provider_mode="platform", consent_signed=True, max_output_tokens=None, quality="premium")
