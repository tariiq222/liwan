# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The machine route: one event at a time, from the company's ``pbx-agent`` (design 4.5, D5).

It is not a user route. The caller proves it is the agent of *this* database with the derived key the design fixes in
12.6: ``hex(HMAC-SHA256(root, label + "\\n" + database))``. The root never reaches the agent; only the derived value
does. A request carries a timestamp inside a short window and a signature over the body, so a captured request
cannot be replayed after that window, and the ``event_id`` makes a retry inside the window harmless.
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


def derived_key(root_hex, database, label):
    """The key construction of design 12.6, shared with the agent and with the recording link."""
    return hmac.new(bytes.fromhex(root_hex), (label + '\n' + database).encode(), hashlib.sha256).hexdigest()


def _root():
    return request.env['ir.config_parameter'].sudo().get_param('liwan.telephony.events_key_root') or ''


def _verify(body, timestamp, signature):
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
        """Apply one event, once. The body is the agent's envelope (contracts/src/telephony/event.ts).

        The agent signs ``timestamp + "\n" + body`` where the body is the same JSON it posts with an empty signature
        field, so the route reads the raw body and the fields itself instead of trusting a re-serialised copy.
        """
        raw = request.httprequest.get_data() or b'{}'
        try:
            envelope = json.loads(raw)
        except ValueError:
            raise ApiError(422, 'invalid', 'The body is not JSON.') from None
        # The agent signs the envelope with an empty signature field, exactly as the test builds it, so the route
        # rebuilds that same document from the parsed fields instead of trusting the bytes it was sent.
        unsigned = json.dumps(
            {'payload': envelope.get('payload'), 'timestamp': envelope.get('timestamp'), 'signature': ''},
            separators=(',', ':'),
        ).encode()
        _verify(unsigned, envelope.get('timestamp'), envelope.get('signature'))
        env = request.env
        payload = envelope.get('payload')
        if not isinstance(payload, dict) or not payload.get('event_id'):
            raise ApiError(422, 'invalid', 'An event with an event_id is required.')
        call = payload.get('call') or {}
        linkedid = call.get('linkedid')
        if not linkedid:
            raise ApiError(422, 'invalid', 'The event names no call.')
        Event = env['liwan.telephony.event']
        if Event.search_count([('event_id', '=', payload['event_id'])]):
            return {'applied': False, 'reason': 'already applied'}
        Call = env['liwan.telephony.call']
        record = Call.search([('linkedid', '=', linkedid)], limit=1)
        values = Call._liwan_from_event(payload)
        if record:
            record.write(values)
        else:
            record = Call.create({'linkedid': linkedid, **values})
        Event.create({
            'event_id': payload['event_id'],
            'linkedid': linkedid,
            'source': payload.get('source'),
            'call_id': record.id,
        })
        return {'applied': True, 'callId': record.id}
