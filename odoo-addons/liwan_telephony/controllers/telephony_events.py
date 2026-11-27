# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The machine route: one event at a time, from the company's ``pbx-agent`` (design 4.5, D5).

It is not a user route. The caller proves it is the agent of *this* database with the derived key the design fixes in
12.6: ``hex(HMAC-SHA256(root, label + "\\n" + database))``. The root never reaches the agent; only the derived value
does.

The contract is the agent's, not a wrapper of ours: the body is the event itself, serialised with sorted keys and
non-ASCII characters kept, and the timestamp and signature travel in the two ``X-Liwan-Telephony-*`` headers. The
signature covers ``b"<timestamp>\\n<body>"`` over the exact bytes received, so nothing is re-serialised here.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

_logger = logging.getLogger(__name__)

EVENTS_LABEL = 'liwan-telephony-events/v1'
CLOCK_WINDOW_SECONDS = 300
TIMESTAMP_HEADER = 'X-Liwan-Telephony-Timestamp'
SIGNATURE_HEADER = 'X-Liwan-Telephony-Signature'


def derived_key(root_hex, database, label):
    """The key construction of design 12.6, shared with the agent and with the recording link."""
    return hmac.new(bytes.fromhex(root_hex), (label + '\n' + database).encode(), hashlib.sha256).hexdigest()


def _root():
    return request.env['ir.config_parameter'].sudo().get_param('liwan.telephony.events_key_root') or ''


def _verify(body, timestamp, signature):
    """The signature of ``b"<timestamp>\\n<body>"`` with this database's derived key, inside the clock window."""
    root = _root()
    if not root:
        raise ApiError(403, 'forbidden', 'The telephony events key is not configured.')
    try:
        sent = datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
    except (TypeError, ValueError):
        raise ApiError(403, 'forbidden', 'A valid timestamp is required.') from None
    if abs(datetime.now(timezone.utc) - sent) > timedelta(seconds=CLOCK_WINDOW_SECONDS):
        raise ApiError(403, 'forbidden', 'The request is outside the accepted clock window.')
    key = derived_key(root, request.env.cr.dbname, EVENTS_LABEL)
    expected = hmac.new(
        bytes.fromhex(key),
        str(timestamp).encode() + b'\n' + body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, str(signature)):
        raise ApiError(403, 'forbidden', 'The signature does not match.')


class TelephonyEventsController(http.Controller):

    @http.route(
        '/api/v1/telephony/events',
        type='json2',
        auth='telephony_events',
        methods=['POST'],
        save_session=False,
        csrf=False,
    )
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def receive_event(self, **_):
        """Apply one event, once. The body is the agent's envelope (contracts/src/telephony/event.ts)."""
        raw = request.httprequest.get_data() or b'{}'
        headers = request.httprequest.headers
        _verify(raw, headers.get(TIMESTAMP_HEADER), headers.get(SIGNATURE_HEADER))
        try:
            payload = json.loads(raw)
        except ValueError:
            raise ApiError(422, 'invalid', 'The body is not JSON.') from None
        if not isinstance(payload, dict) or not payload.get('event_id'):
            raise ApiError(422, 'invalid', 'An event with an event_id is required.')
        call = payload.get('call') or {}
        linkedid = call.get('linkedid')
        if not linkedid:
            raise ApiError(422, 'invalid', 'The event names no call.')
        env = request.env
        Event = env['liwan.telephony.event']
        if Event.search_count([('event_id', '=', payload['event_id'])]):
            return {'applied': False, 'reason': 'already applied'}
        Call = env['liwan.telephony.call']
        record = Call.search([('linkedid', '=', linkedid)], limit=1)
        values = Call._liwan_from_event(payload)
        if record:
            record._liwan_apply(values)
        else:
            record = Call.create({'linkedid': linkedid, **values})
        record._liwan_link_participants()
        Event.create({
            'event_id': payload['event_id'],
            'linkedid': linkedid,
            'source': payload.get('source'),
            'call_id': record.id,
        })
        return {'applied': True, 'callId': record.id}
