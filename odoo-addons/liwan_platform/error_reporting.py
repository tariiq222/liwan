# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Optional error reporting to a Sentry server (owner decision 2026-11-18): unexpected errors only, scrubbed, off by default.

``LIWAN_SENTRY_DSN`` unset or empty leaves the SDK unimported and nothing leaves the process, so a customer-hosted install
runs with no vendor connection. With a DSN the SDK is required, and a missing package stops the start instead of
silently reporting nothing.

One hook covers every unexpected error: a log record at ERROR level. That is where ``api_handler`` (``api internal
error``), a failed cron and the ``auth='inbox_hook'`` http routes all end. A handled 403, 404 or 422 is answered, not
logged at that level, so it makes no event. Tracing, profiling, breadcrumbs, local variables and the SDK's own integrations
are off, and ``before_send`` rebuilds everything an event may carry about the request, the user and the logged text.
"""
import logging
import os
import re
import threading
from typing import NamedTuple

from odoo.http import request

from .outbound_scan import withhold_text
from .secret_mask import mask_access_tokens

DSN_ENV = 'LIWAN_SENTRY_DSN'
ENVIRONMENT_ENV = 'LIWAN_SENTRY_ENVIRONMENT'
# What an event keeps of the request, and the tag every event carries.
RUNTIME_TAG = 'odoo'
# Event fields copied unchanged; every other section (contexts, threads, extra, breadcrumbs, modules, server_name, sdk...) is dropped.
KEPT_FIELDS = ('event_id', 'timestamp', 'level', 'platform', 'logger', 'environment', 'release')
KEPT_FRAME_FIELDS = ('filename', 'module', 'function', 'lineno', 'in_app')
# An exception text is a hint to the stack, never a carrier of the data that broke it.
MAX_TEXT_LENGTH = 300
BEARER = re.compile(r'(?i)\bBearer\s+\S+')
URL_USERINFO = re.compile(r'(?i)(\b[a-z][a-z0-9+.\-]*://)[^/\s@]+@')


class EventContext(NamedTuple):
    """What the reporting thread knows about the failing work, read when the event is sent."""
    dbname: str | None
    method: str | None
    path: str | None
    user_agent: str | None
    uid: int | None


def init_error_reporting():
    """Start the SDK when ``LIWAN_SENTRY_DSN`` is set; answer whether it started."""
    dsn = os.environ.get(DSN_ENV, '').strip()
    if not dsn:
        return False
    try:
        import sentry_sdk  # noqa: PLC0415 (imported only when a DSN asks for reporting)
        from sentry_sdk.integrations.atexit import AtexitIntegration  # noqa: PLC0415
        from sentry_sdk.integrations.logging import LoggingIntegration  # noqa: PLC0415
    except ImportError as error:
        message = f'{DSN_ENV} is set but the sentry-sdk package is not installed'
        raise RuntimeError(message) from error
    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get(ENVIRONMENT_ENV, '').strip() or None,
        # send_default_pii stays unset: the SDK treats that as False and deprecates the option, so it is not passed.
        include_local_variables=False,
        include_source_context=False,
        max_breadcrumbs=0,
        default_integrations=False,
        auto_enabling_integrations=False,
        # No traces_sample_rate and no profiles_sample_rate: tracing and profiling stay off.
        integrations=[
            LoggingIntegration(level=None, event_level=logging.ERROR),
            AtexitIntegration(),
        ],
        before_send=before_send,
    )
    return True


def current_context():
    """The database and, inside an HTTP request, its method, path and user agent, read from the reporting thread."""
    dbname = getattr(threading.current_thread(), 'dbname', None)
    if not request:
        return EventContext(dbname, None, None, None, None)
    http_request = request.httprequest
    return EventContext(
        dbname, http_request.method, http_request.path, http_request.headers.get('User-Agent'), request.session.uid,
    )


def before_send(event, hint):
    return scrub_event(event, current_context())


def scrub_event(event, context):
    """A new event built from an allow-list: no body, cookie, header, variable, source line, extra or personal value."""
    scrubbed = {field: event[field] for field in KEPT_FIELDS if field in event}
    tags = {'runtime': RUNTIME_TAG}
    if context.dbname:
        tags['tenant'] = context.dbname
    scrubbed['tags'] = tags
    if context.method:
        scrubbed['request'] = {
            'method': context.method,
            'url': mask_access_tokens(context.path),
            'headers': {'User-Agent': context.user_agent or ''},
        }
    if context.uid:
        scrubbed['user'] = {'id': str(context.uid)}
    if 'logentry' in event:
        # A log line's arguments and formatted text are free text (names, notes) that no pattern scan can vouch for:
        # only the static template leaves, and the top-level message built from the formatted text goes with them.
        scrubbed['logentry'] = {'message': clean_text(event['logentry'].get('message') or '')[:MAX_TEXT_LENGTH]}
    elif 'message' in event:
        scrubbed['message'] = clean_text(event['message'])[:MAX_TEXT_LENGTH]
    if 'exception' in event:
        scrubbed['exception'] = {'values': [clean_exception(value) for value in event['exception'].get('values', ())]}
    return scrubbed


def clean_exception(exception):
    """One exception reduced to its type, cut text, mechanism flags and frames of names and line numbers."""
    cleaned = {}
    if exception.get('type'):
        cleaned['type'] = clean_text(exception['type'])[:MAX_TEXT_LENGTH]
    if exception.get('value'):
        cleaned['value'] = clean_text(exception['value'])[:MAX_TEXT_LENGTH]
    mechanism = exception.get('mechanism')
    if mechanism:
        cleaned['mechanism'] = {key: mechanism[key] for key in ('type', 'handled') if key in mechanism}
    frames = exception.get('stacktrace', {}).get('frames')
    if frames is not None:
        cleaned['stacktrace'] = {'frames': [
            {key: frame[key] for key in KEPT_FRAME_FIELDS if key in frame} for frame in frames
        ]}
    return cleaned


def clean_text(text):
    """``text`` with every private value, URL credential, Bearer token and secret query or path token replaced."""
    text = BEARER.sub('Bearer [redacted]', URL_USERINFO.sub(r'\1[redacted]@', str(text)))
    return mask_access_tokens(withhold_text(text))
