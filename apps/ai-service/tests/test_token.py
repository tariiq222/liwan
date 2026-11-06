"""The shared service token: every route but /healthz needs it, and only AI_DEV_INSECURE=true may boot without one."""
import hmac
import logging

import httpx
import pytest

from liwan_ai_service.settings import PLATFORM_PROVIDER_FILE, Settings, SettingsError
from tests.fakes import PLATFORM_POLICY, ScriptedChatModel, ai_text, make_memory_app
from tests.platform_file import platform_env
from tests.test_service import BODY, HEADERS, fresh, parse_sse

TOKEN = "t" * 24 + "-service-token"
ENV = {**platform_env(), "AI_ALLOW_MEMORY_STATE": "true"}
DEV_INSECURE = {**ENV, "AI_DEV_INSECURE": "true"}
WITH_TOKEN = {**HEADERS, "X-Liwan-Service-Token": TOKEN}


def make_client(token=TOKEN, responses=(), settings=None):
    settings = settings or Settings.from_env(
        {**ENV, **({"AI_SERVICE_TOKEN": token} if token else {"AI_DEV_INSECURE": "true"})}
    )
    app = make_memory_app(ScriptedChatModel(list(responses)), settings)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai")


def test_the_token_is_required_and_read_from_the_environment():
    with pytest.raises(SettingsError) as error:
        Settings.from_env(ENV)
    assert error.value.variable == "AI_SERVICE_TOKEN"
    assert Settings.from_env({**ENV, "AI_SERVICE_TOKEN": TOKEN}).service_token == TOKEN


def test_the_dev_flag_is_the_only_way_to_run_without_a_token():
    assert Settings.from_env(DEV_INSECURE).service_token is None


@pytest.mark.parametrize("token", ["short", "x" * 23])
def test_a_token_shorter_than_24_characters_is_rejected_without_echoing_it(token):
    with pytest.raises(ValueError, match="AI_SERVICE_TOKEN") as error:
        Settings.from_env({**ENV, "AI_SERVICE_TOKEN": token})
    assert isinstance(error.value, SettingsError) and error.value.variable == "AI_SERVICE_TOKEN" and token not in str(error.value)


async def test_a_missing_or_wrong_token_is_401_with_a_fixed_body_on_every_route():
    async with make_client() as client:
        bodies = set()
        for headers in (HEADERS, {**HEADERS, "X-Liwan-Service-Token": "wrong"}, {**HEADERS, "X-Liwan-Service-Token": TOKEN + "x"}):
            for method, path, kwargs in (
                ("POST", "/v1/runs", {"json": BODY}),
                ("POST", "/v1/runs/r_x/resume", {"json": {"call_id": "c", "policy": PLATFORM_POLICY, "result": {"ok": False, "decision": "rejected"}}}),
                ("POST", "/v1/runs/r_x/claim", {"json": {"call_id": "c"}}),
                ("GET", "/v1/runs/r_x", {}),
            ):
                response = await client.request(method, path, headers=headers, **kwargs)
                assert response.status_code == 401
                bodies.add(response.text)
        assert len(bodies) == 1 and TOKEN not in bodies.pop()
        assert (await client.post("/v1/runs", json=fresh())).status_code == 401  # even before the owner headers are checked


async def test_the_right_token_is_accepted_and_healthz_stays_open(caplog):
    caplog.set_level(logging.DEBUG)
    async with make_client(responses=[ai_text("تم")]) as client:
        assert (await client.get("/healthz")).json() == {"ok": True}
        response = await client.post("/v1/runs", json=fresh(), headers=WITH_TOKEN)
        assert response.status_code == 200 and TOKEN not in response.text
        events = parse_sse(response.text)
        run_id = events[0][1]["run_id"]
        assert (await client.get(f"/v1/runs/{run_id}", headers=WITH_TOKEN)).status_code == 200
    assert TOKEN not in caplog.text


async def test_without_a_configured_token_nothing_is_required():
    async with make_client(token=None, responses=[ai_text("تم")]) as client:
        assert (await client.post("/v1/runs", json=fresh(), headers=HEADERS)).status_code == 200


async def test_the_token_is_compared_in_constant_time(monkeypatch):
    seen = []
    real = hmac.compare_digest

    def spy(a, b):
        seen.append((a, b))
        return real(a, b)

    monkeypatch.setattr(hmac, "compare_digest", spy)
    async with make_client() as client:
        await client.get("/v1/runs/r_x", headers=WITH_TOKEN)
        await client.get("/v1/runs/r_x", headers={**HEADERS, "X-Liwan-Service-Token": "nope"})
    assert len(seen) == 2 and all(TOKEN.encode() in pair for pair in seen[:1])


async def test_env_app_passes_the_token_through(monkeypatch):
    from liwan_ai_service import service

    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_SERVICE_TOKEN", TOKEN)
    monkeypatch.delenv("AI_DATABASE_URL", raising=False)
    app, queue = service.EnvApp(), [{"type": "lifespan.startup"}, {"type": "lifespan.shutdown"}]
    statuses = []

    async def receive():
        return queue.pop(0)

    async def send(message):
        if message["type"] == "lifespan.startup.complete":
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as client:
                statuses.append((await client.get("/v1/runs/r_x", headers=HEADERS)).status_code)
                statuses.append((await client.get("/v1/runs/r_x", headers=WITH_TOKEN)).status_code)
                statuses.append((await client.get("/healthz")).status_code)

    await app({"type": "lifespan"}, receive, send)
    assert statuses == [401, 404, 200]


async def test_a_too_short_token_stops_the_server_from_starting(monkeypatch):
    from liwan_ai_service import service

    monkeypatch.setenv(PLATFORM_PROVIDER_FILE, platform_env()[PLATFORM_PROVIDER_FILE])
    monkeypatch.setenv("AI_ALLOW_MEMORY_STATE", "true")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "short")
    sent = []

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        sent.append(message)

    await service.EnvApp()({"type": "lifespan"}, receive, send)
    assert sent == [{"type": "lifespan.startup.failed", "message": "SettingsError: AI_SERVICE_TOKEN"}]
