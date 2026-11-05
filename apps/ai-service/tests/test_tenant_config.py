"""The tenant's own AI configuration: write-only key, signed AI acknowledgement, output cap and per-tenant retention."""
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest

from liwan_ai_service import cleanup, service
from liwan_ai_service.settings import Settings, SettingsError
from liwan_ai_service.tenant_config import Keyring
from tests.fakes import PLATFORM_POLICY, ScriptedChatModel, ai_text, ai_tool_call, ai_usage, make_memory_app, new_id
from tests.test_cleanup import MappingDirectory, SeedStates
from tests.test_service import BODY, HEADERS, SETTINGS, parse_sse

SECRET = "s" * 40
KEYRING = Keyring({"k1": SECRET}, "k1")
TENANT_KEY = "sk-tenant-0123456789abcd"
TENANT_POLICY = {**PLATFORM_POLICY, "provider_mode": "tenant_key"}
KEY_BODY = {"provider": "anthropic", "model": "claude-test", "api_key": TENANT_KEY}


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


def run_body(policy):
    return {**BODY, "policy": policy, "new_run_id": new_id()}


async def test_the_key_is_write_only_and_retention_is_bounded():
    async with client_for(make_memory_app(ScriptedChatModel([]), replace(SETTINGS, keyring=KEYRING))) as client:
        initial = (await client.get("/v1/tenant/config", headers=HEADERS)).json()
        assert initial["retention_days"] == 30 and initial["key"]["configured"] is False
        assert initial["platform"] == {"provider": "ollama", "model": "m"}
        assert {"name": "anthropic", "needs_api_key": True} in initial["providers"]
        written = await client.put("/v1/tenant/config/key", json=KEY_BODY, headers=HEADERS)
        assert written.status_code == 200 and TENANT_KEY not in written.text
        assert written.json()["key"] | {"updated_at": None} == {
            "configured": True, "provider": "anthropic", "model": "claude-test", "last4": "abcd", "updated_at": None,
        }
        assert TENANT_KEY not in (await client.get("/v1/tenant/config", headers=HEADERS)).text
        keyless = await client.put("/v1/tenant/config/key", json={**KEY_BODY, "provider": "ollama"}, headers=HEADERS)
        assert keyless.status_code == 422
        for days in (0, 366):
            assert (await client.put("/v1/tenant/config/retention", json={"retention_days": days}, headers=HEADERS)).status_code == 422
        kept = await client.put("/v1/tenant/config/retention", json={"retention_days": 7}, headers=HEADERS)
        assert kept.json()["retention_days"] == 7
        cleared = await client.delete("/v1/tenant/config/key", headers=HEADERS)
        assert cleared.json()["key"]["configured"] is False


async def test_a_deployment_without_a_keyring_cannot_store_a_key():
    async with client_for(make_memory_app(ScriptedChatModel([]), SETTINGS)) as client:
        response = await client.put("/v1/tenant/config/key", json=KEY_BODY, headers=HEADERS)
    assert response.status_code == 503 and response.json() == {"detail": "ai_key_unavailable"}


async def test_a_tenant_key_policy_without_a_key_is_refused_and_never_falls_back_to_the_platform():
    model = ScriptedChatModel([ai_text("لا")])
    async with client_for(make_memory_app(model, replace(SETTINGS, keyring=KEYRING))) as client:
        response = await client.post("/v1/runs", json=run_body(TENANT_POLICY), headers=HEADERS)
    assert response.status_code == 409 and response.json() == {"detail": "ai_tenant_key_missing"}
    assert model.calls == []


async def test_a_tenant_key_run_uses_the_tenants_model_and_is_billed_to_the_tenant(monkeypatch):
    tenant_model = ScriptedChatModel([ai_text("تم")])
    built = []

    def build(settings, provider, model, api_key):
        built.append((provider, model, api_key))
        return tenant_model

    monkeypatch.setattr(service, "build_tenant_model", build)
    platform = ScriptedChatModel([])
    async with client_for(make_memory_app(platform, replace(SETTINGS, keyring=KEYRING))) as client:
        await client.put("/v1/tenant/config/key", json=KEY_BODY, headers=HEADERS)
        events = parse_sse((await client.post("/v1/runs", json=run_body(TENANT_POLICY), headers=HEADERS)).text)
    assert built == [("anthropic", "claude-test", TENANT_KEY)]
    calls = [data for name, data in events if name == "model_call"]
    assert calls and all(call["billing"] == "tenant_key" and call["provider"] == "anthropic" for call in calls)
    assert platform.calls == [] and events[-1][1] == {"status": "done"}


UNSIGNED = {**PLATFORM_POLICY, "consent_signed": False}


@pytest.mark.parametrize("provider", ["ollama", "anthropic"])
async def test_no_provider_sees_the_message_without_the_signed_acknowledgement(provider):
    # Every provider, a local model included: the acknowledgement is not about where a provider processes (§6.8).
    model = ScriptedChatModel([ai_text("x")])
    settings = Settings.from_env({
        "AI_PROVIDER": provider, "AI_MODEL": "m", "AI_API_KEY": "sk-platform", "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true",
    })
    async with client_for(make_memory_app(model, settings)) as client:
        for policy in (UNSIGNED, {**UNSIGNED, "provider_mode": "setup"}, {**UNSIGNED, "provider_mode": "tenant_key"}):
            refused = await client.post("/v1/runs", json=run_body(policy), headers=HEADERS)
            assert refused.status_code == 403 and refused.json() == {"detail": "ai_consent_required"}
        assert model.calls == []
        allowed = await client.post("/v1/runs", json=run_body(PLATFORM_POLICY), headers=HEADERS)
    assert parse_sse(allowed.text)[-1][1] == {"status": "done"}


async def test_a_revoked_consent_stops_a_waiting_run_at_its_resume():
    model = ScriptedChatModel([ai_tool_call("pmo__list_my_tasks", {}, "c_1"), ai_text("تم")])
    settings = Settings.from_env({
        "AI_PROVIDER": "anthropic", "AI_MODEL": "m", "AI_API_KEY": "sk-platform", "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true",
    })
    async with client_for(make_memory_app(model, settings)) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=run_body(PLATFORM_POLICY), headers=HEADERS)).text)[0][1]["run_id"]
        result = {"ok": True, "data": {"items": [], "total": 0}}
        revoked = await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "policy": UNSIGNED, "result": result}, headers=HEADERS)
        assert revoked.status_code == 403
        resumed = await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "policy": PLATFORM_POLICY, "result": result}, headers=HEADERS)
    assert parse_sse(resumed.text)[-1][1] == {"status": "done"}


async def test_the_output_cap_stops_the_run_with_its_own_limit():
    model = ScriptedChatModel([ai_usage(ai_tool_call("pmo__list_my_tasks", {}, "c_1"), 50, 900), ai_text("never")])
    capped = {**PLATFORM_POLICY, "max_output_tokens": 500}
    async with client_for(make_memory_app(model, SETTINGS)) as client:
        run_id = parse_sse((await client.post("/v1/runs", json=run_body(capped), headers=HEADERS)).text)[0][1]["run_id"]
        result = {"ok": True, "data": {"items": [], "total": 0}}
        events = parse_sse((await client.post(f"/v1/runs/{run_id}/resume", json={"call_id": "c_1", "policy": capped, "result": result}, headers=HEADERS)).text)
    assert ("limit_reached", {"limit": "output_tokens"}) in events
    assert events[-1][1] == {"status": "limit_reached"} and len(model.calls) == 1


async def test_cleanup_keeps_each_tenants_own_window(monkeypatch):
    states = SeedStates(MappingDirectory({"short": "short", "long": "long"}))
    for tenant, window in (("short", 7), ("long", 30)):
        async with states.use(tenant) as state:
            await state.config.set_retention(window)
            record = await state.store.create(new_id(), "42")
            state.store.records[record.run_id].updated_at -= timedelta(days=10)
    monkeypatch.setattr(cleanup, "open_tenant_states", lambda _url: states)
    monkeypatch.setenv("AI_DATABASE_URL", "postgresql://ai@db/ai")
    report, failures = await cleanup.run()
    assert report == "deleted 1 runs past their retention in 2 tenants" and failures == []
    assert states.stores["short"].records == {} and len(states.stores["long"].records) == 1


@pytest.mark.parametrize("environ", [
    {"AI_KEY_ENCRYPTION_KEYS": "k1:short", "AI_KEY_ENCRYPTION_KEY_ID": "k1"},
    {"AI_KEY_ENCRYPTION_KEYS": f"k1:{SECRET}", "AI_KEY_ENCRYPTION_KEY_ID": "k2"},
    {"AI_KEY_ENCRYPTION_KEYS": f"k1:{SECRET},k1:{SECRET}", "AI_KEY_ENCRYPTION_KEY_ID": "k1"},
    {"AI_KEY_ENCRYPTION_KEYS": f"K1:{SECRET}", "AI_KEY_ENCRYPTION_KEY_ID": "K1"},
    {"AI_KEY_ENCRYPTION_KEY_ID": "k1"},
])
def test_a_bad_keyring_fails_the_boot(environ):
    with pytest.raises(SettingsError):
        Keyring.from_env(environ)


def test_the_keyring_is_optional_and_names_its_current_secret():
    assert Keyring.from_env({}) is None
    keyring = Keyring.from_env({"AI_KEY_ENCRYPTION_KEYS": f"k1:{SECRET},k2:{'t' * 40}", "AI_KEY_ENCRYPTION_KEY_ID": "k2"})
    assert keyring.current_id == "k2" and keyring.secret("k1") == SECRET



async def test_a_zero_cap_answers_nothing_and_calls_no_provider():
    model = ScriptedChatModel([ai_text("never")])
    async with client_for(make_memory_app(model, SETTINGS)) as client:
        events = parse_sse((await client.post("/v1/runs", json=run_body({**PLATFORM_POLICY, "max_output_tokens": 0}), headers=HEADERS)).text)
    assert ("limit_reached", {"limit": "output_tokens"}) in events and model.calls == []


async def test_a_setup_run_uses_the_platform_provider_and_bills_the_setup_budget():
    platform = ScriptedChatModel([ai_text("ok")])
    async with client_for(make_memory_app(platform, replace(SETTINGS, keyring=KEYRING))) as client:
        await client.put("/v1/tenant/config/key", json=KEY_BODY, headers=HEADERS)  # a tenant key never runs a setup conversation
        events = parse_sse((await client.post("/v1/runs", json=run_body({**PLATFORM_POLICY, "provider_mode": "setup"}), headers=HEADERS)).text)
    calls = [data for name, data in events if name == "model_call"]
    assert calls and all(call["billing"] == "setup" and call["provider"] == "ollama" for call in calls)
    assert platform.calls and events[-1][1] == {"status": "done"}
