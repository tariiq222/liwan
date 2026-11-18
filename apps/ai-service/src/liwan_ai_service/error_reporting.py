"""Optional error reporting to the operator's self-hosted Sentry: unexpected errors only, scrubbed before they leave.

Nothing here runs without ``AI_SENTRY_DSN``: ``sentry_sdk`` is imported only by ``init_error_reporting``. An event carries the
exception class and its scanned message, the stack, the request method, path and user agent, the caller's ids and
the ``runtime`` tag; never a body, a cookie, a header value beyond those, a local variable, a prompt or a completion.
Handled client errors (4xx ``HTTPException``) are not reported, nor are 5xx ``HTTPException`` answers such as a draining
generation: only an exception that nobody handled and an ERROR log line become events.

The scan is this service's own copy of the outbound data policy shapes (``odoo-addons/liwan_ai/models/outbound_scan.py``):
the service is a separate deployable and imports neither the Odoo nor the web copy. It errs towards withholding.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from importlib.metadata import version
from typing import Any
from urllib.parse import urlsplit

from liwan_ai_service.errors import redact
from liwan_ai_service.settings import SentrySettings

REPORTED_HEADERS = {"user-agent": "User-Agent"}
TENANT_HEADER = "x-liwan-tenant"
USER_HEADER = "x-liwan-user"
MAX_MESSAGE_LENGTH = 300  # an exception text is a hint to the stack, never a carrier of the data that broke it
BEARER = re.compile(r"\bBearer\s+\S+", re.IGNORECASE)
# Longer shapes first: an IBAN holds digit runs and an email may hold one.
PATTERNS = (
    ("email", re.compile(r"[\w.%+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}")),
    ("iban", re.compile(r"\b[A-Za-z]{2}\d{2}(?:[ -]?[0-9A-Za-z]){11,30}\b")),
    ("phone", re.compile(r"(?<![0-9+])(?:\(?(?:\+|00)?966\)?[\s.-]?(?:0[\s.-]?)?|0)5(?:[\s.-]?[0-9]){8}(?![0-9])")),
    ("national_id", re.compile(r"(?<![0-9])[12](?:[\s.-]?[0-9]){9}(?![0-9])")),
)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
VALIDATION_ERRORS = {"ValidationError", "RequestValidationError"}  # their text echoes the rejected input


class ErrorReportingUnavailable(RuntimeError):
    """``AI_SENTRY_DSN`` is set but ``sentry_sdk`` cannot be imported: the boot stops rather than run unreported."""


def scan_text(text: str, secrets: tuple[str | None, ...] = ()) -> str:
    """``text`` with secrets, URLs, key-shaped tokens, Bearer tokens and personal identifiers withheld (digits read as Latin)."""
    text = BEARER.sub("[redacted]", redact(text, secrets)).translate(ARABIC_DIGITS)
    for kind, pattern in PATTERNS:
        text = pattern.sub(f"[{kind} withheld]", text)
    return text


def scrub_event(event: dict[str, Any], secrets: tuple[str | None, ...], release: str) -> dict[str, Any]:
    """The event as it may leave: the request cut to method, path and user agent, every text scanned, the ids as tags."""
    request = event.get("request") or {}
    headers = {str(name).lower(): value for name, value in (request.get("headers") or {}).items()}
    event["request"] = {
        "method": request.get("method"),
        "url": urlsplit(request.get("url") or "").path,
        "headers": {label: headers[name] for name, label in REPORTED_HEADERS.items() if name in headers},
    }
    tags = {"runtime": "ai-service", "release": release}
    if headers.get(TENANT_HEADER):
        tags["tenant"] = scan_text(str(headers[TENANT_HEADER]), secrets)
    event["tags"] = tags
    event["user"] = {"id": scan_text(str(headers[USER_HEADER]), secrets)} if headers.get(USER_HEADER) else {}
    for key in ("extra", "breadcrumbs", "server_name", "modules"):
        event.pop(key, None)
    for exception in (event.get("exception") or {}).get("values") or []:
        value = exception.get("value")
        if value is not None:
            exception["value"] = "" if exception.get("type") in VALIDATION_ERRORS else scan_text(value, secrets)[:MAX_MESSAGE_LENGTH]
        for frame in (exception.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    if event.get("message"):
        event["message"] = scan_text(event["message"], secrets)
    logentry = event.get("logentry")
    if logentry:
        event["logentry"] = {"message": scan_text(logentry.get("formatted") or logentry.get("message") or "", secrets)}
    return event


def scrub_breadcrumb(crumb: dict[str, Any], secrets: tuple[str | None, ...]) -> dict[str, Any]:
    """A breadcrumb keeps its category, level and scanned message; its data (URLs, payloads) is dropped."""
    crumb.pop("data", None)
    if crumb.get("message"):
        crumb["message"] = scan_text(crumb["message"], secrets)
    return crumb


def init_error_reporting(settings: SentrySettings, secrets: Callable[[], tuple[str | None, ...]] = tuple, *, transport: Any = None) -> None:
    """Start the SDK for the process; ``transport`` is for tests (an in-memory capture, no network)."""
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError as error:
        msg = "AI_SENTRY_DSN is set but sentry-sdk is not installed"
        raise ErrorReportingUnavailable(msg) from error
    release = f"liwan-ai-service@{version('liwan-ai-service')}"
    handled_by_the_service = set()  # a 5xx HTTPException is an answer the service chose (draining, state contract), not a fault
    sentry_sdk.init(
        dsn=settings.dsn,
        environment=settings.environment,
        release=release,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=None,
        profiles_sample_rate=None,
        auto_enabling_integrations=False,
        integrations=[
            StarletteIntegration(failed_request_status_codes=handled_by_the_service),
            FastApiIntegration(failed_request_status_codes=handled_by_the_service),
            LoggingIntegration(level=None, event_level=logging.ERROR),
        ],
        before_send=lambda event, _hint: scrub_event(event, secrets(), release),
        before_breadcrumb=lambda crumb, _hint: scrub_breadcrumb(crumb, secrets()),
        transport=transport,
    )
