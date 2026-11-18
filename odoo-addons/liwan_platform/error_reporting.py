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
import threading
from typing import NamedTuple

from odoo.http import request

from .outbound_scan import withhold_text
from .secret_mask import mask_access_tokens

DSN_ENV = 'LIWAN_SENTRY_DSN'
ENVIRONMENT_ENV = 'LIWAN_SENTRY_ENVIRONMENT'
# What an event keeps of the request, and the tag every event carries.
RUNTIME_TAG = 'odoo'
# Event sections that only carry context beyond the scrubbed ones: free-form extras, breadcrumbs, loaded modules, the host.
DROPPED_SECTIONS = ('extra', 'breadcrumbs', 'modules', 'server_name')


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
    """``event`` rebuilt to carry only what the policy allows: no body, cookie, header, variable, extra or personal value."""
    for section in DROPPED_SECTIONS:
        event.pop(section, None)
    tags = {'runtime': RUNTIME_TAG}
    if context.dbname:
        tags['tenant_db'] = context.dbname
    event['tags'] = tags
    event.pop('request', None)
    if context.method:
        event['request'] = {
            'method': context.method,
            'url': mask_access_tokens(context.path),
            'headers': {'User-Agent': context.user_agent or ''},
        }
    event.pop('user', None)
    if context.uid:
        event['user'] = {'id': str(context.uid)}
    if 'message' in event:
        event['message'] = clean_text(event['message'])
    if 'logentry' in event:
        event['logentry'] = clean_log_entry(event['logentry'])
    for exception in event.get('exception', {}).get('values', ()):
        if exception.get('value'):
            exception['value'] = clean_text(exception['value'])
    return event


def clean_text(text):
    """``text`` with every private value and every secret query or path token replaced."""
    return mask_access_tokens(withhold_text(str(text)))


def clean_log_entry(entry):
    """A log entry with its message, formatted text and arguments cleaned; arguments are kept as text."""
    cleaned = {key: clean_text(value) for key, value in entry.items() if key in ('message', 'formatted') and value}
    params = entry.get('params')
    if isinstance(params, dict):
        cleaned['params'] = {key: clean_text(value) for key, value in params.items()}
    elif params:
        cleaned['params'] = [clean_text(value) for value in params]
    return cleaned
