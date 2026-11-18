"""Optional error reporting: off without a DSN, one scrubbed event per unexpected error, nothing for a handled one."""
import builtins
import functools
import json
import sys

import httpx
import pytest
from fastapi import HTTPException
from sentry_sdk.transport import Transport

from liwan_ai_service import service
from liwan_ai_service.error_reporting import ErrorReportingUnavailable, init_error_reporting, scan_text
from liwan_ai_service.settings import Settings
from tests.fakes import ScriptedChatModel, make_memory_app
from tests.platform_file import platform_env

DSN = "https://publickey@sentry.example.net/1"
COOKIE = "session=cookie-fixture-7f3a"
BODY_TEXT = "prompt-body-fixture: summarise the salary sheet"
LOCAL_VARIABLE = "local-variable-fixture-91c2"
PROVIDER_KEY = "sk-ant-api03-providerkeyfixture"
PHONE = "0551234567"
EMAIL = "customer@example.com"
IBAN = "SA0380000000608010167519"
NATIONAL_ID = "1010101010"
HEADERS = {"X-Liwan-Tenant": "t1", "X-Liwan-User": "42", "User-Agent": "nuxt-server", "Cookie": COOKIE, "Authorization": "Bearer access_token_fixture"}


class CaptureTransport(Transport):
    """An in-memory stand-in for the SDK's transport: every envelope item is kept, nothing leaves the process."""

    def __init__(self, options=None):
        super().__init__(options)
        self.events = []

    def capture_envelope(self, envelope):
        for item in envelope.items:
            if item.headers.get("type") == "event":
                self.events.append(item.payload.json)

    def flush(self, timeout, callback=None):
        pass

    def kill(self):
        pass

    def is_healthy(self):
        return True


@pytest.fixture
def reporting():
    import sentry_sdk

    transport = CaptureTransport()
    yield transport
    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)  # no client: a later test reports nothing (init() would auto-enable SDK integrations)


def app_with_failing_routes(transport, monkeypatch):
    monkeypatch.setattr(service, "init_error_reporting", functools.partial(init_error_reporting, transport=transport))
    settings = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true", "AI_SENTRY_DSN": DSN})
    app = make_memory_app(ScriptedChatModel([]), settings)

    @app.post("/boom")
    async def boom():
        local_variable = LOCAL_VARIABLE  # noqa: F841 - the event must not carry it
        raise RuntimeError(f"provider said {PROVIDER_KEY} for {EMAIL} {PHONE} {IBAN} {NATIONAL_ID}")

    @app.post("/denied")
    async def denied():
        raise HTTPException(404, "run not found")

    @app.post("/draining")
    async def draining():
        raise HTTPException(503, "AI generation is draining")

    return app


def client_of(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://ai")


async def test_an_unexpected_error_yields_one_scrubbed_event(reporting, monkeypatch):
    app = app_with_failing_routes(reporting, monkeypatch)
    async with client_of(app) as client:
        response = await client.post("/boom?access_token=query_token_fixture", headers=HEADERS, json={"message": BODY_TEXT})
    assert response.status_code == 500
    assert len(reporting.events) == 1
    event = reporting.events[0]
    payload = json.dumps(event, ensure_ascii=False)
    for forbidden in (COOKIE, BODY_TEXT, LOCAL_VARIABLE, "access_token", "query_token_fixture", PHONE, EMAIL, IBAN, NATIONAL_ID, PROVIDER_KEY):
        assert forbidden not in payload
    assert event["request"] == {"method": "POST", "url": "/boom", "headers": {"User-Agent": "nuxt-server"}}
    assert event["user"] == {"id": "42"}
    assert event["tags"]["tenant"] == "t1"
    assert event["tags"]["runtime"] == "ai-service"
    assert event["tags"]["release"].startswith("liwan-ai-service@")
    assert event["exception"]["values"][-1]["type"] == "RuntimeError"


async def test_handled_answers_yield_no_event(reporting, monkeypatch):
    app = app_with_failing_routes(reporting, monkeypatch)
    async with client_of(app) as client:
        assert (await client.post("/denied", headers=HEADERS)).status_code == 404
        assert (await client.post("/draining", headers=HEADERS)).status_code == 503
    assert reporting.events == []


def test_without_a_dsn_the_sdk_is_never_imported(monkeypatch):
    for name in [name for name in sys.modules if name == "sentry_sdk" or name.startswith("sentry_sdk.")]:
        monkeypatch.delitem(sys.modules, name)
    settings = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true"})
    assert settings.sentry is None
    make_memory_app(ScriptedChatModel([]), settings)
    assert "sentry_sdk" not in sys.modules


def test_a_dsn_with_the_sdk_missing_stops_the_boot(monkeypatch):
    real_import = builtins.__import__

    def refuse_sentry(name, *args, **kwargs):
        if name.split(".")[0] == "sentry_sdk":
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    for name in [name for name in sys.modules if name == "sentry_sdk" or name.startswith("sentry_sdk.")]:
        monkeypatch.delitem(sys.modules, name)
    monkeypatch.setattr(builtins, "__import__", refuse_sentry)
    settings = Settings.from_env({**platform_env(), "AI_ALLOW_MEMORY_STATE": "true", "AI_DEV_INSECURE": "true", "AI_SENTRY_DSN": DSN})
    with pytest.raises(ErrorReportingUnavailable):
        make_memory_app(ScriptedChatModel([]), settings)


def test_the_scan_withholds_identifiers_and_keys():
    text = f"{EMAIL} {PHONE} +966 55 123 4567 {IBAN} {NATIONAL_ID} ١٠١٠١٠١٠١٠ Bearer abc.def {PROVIDER_KEY} https://api.example.com/v1?key=1"
    scanned = scan_text(text)
    for forbidden in (EMAIL, PHONE, "123 4567", IBAN, NATIONAL_ID, "١٠١٠", "abc.def", PROVIDER_KEY, "api.example.com"):
        assert forbidden not in scanned
    assert scan_text("run failed in step 3") == "run failed in step 3"
