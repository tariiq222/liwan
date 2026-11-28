# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The machine route: one event at a time, from the company's ``pbx-agent`` (design 4.5, D5).

It is not a user route. The caller proves it is the agent of *this* database with the derived key the design fixes in
12.6: ``hex(HMAC-SHA256(root, label + "\\n" + database))``. The root never reaches the agent; only the derived value
does.

The contract is the agent's, not a wrapper of ours: the body is the event itself, serialised with sorted keys and
non-ASCII characters kept, and the timestamp and signature travel in the two ``X-Liwan-Telephony-*`` headers. The
signature covers ``b"<timestamp>\\n<body>"`` over the exact bytes received, so nothing is re-serialised here.

A call is stored under the company of the extension the event names, the root company being only the fallback for a
call that names none (decision 0.6). The events identity works in that company through ``with_company``: nothing here
is elevated.
"""
import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone

from psycopg2 import IntegrityError

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE
from odoo.addons.liwan_telephony.models.telephony_call import (
    DIRECTIONS,
    LINKEDID_PATTERN,
    RECORDING_READY,
    STATES,
    TIMESTAMP_FIELDS,
    parse_iso_timestamp,
)

EVENTS_LABEL = 'liwan-telephony-events/v1'
CLOCK_WINDOW_SECONDS = 300
TIMESTAMP_HEADER = 'X-Liwan-Telephony-Timestamp'
SIGNATURE_HEADER = 'X-Liwan-Telephony-Signature'
KEY_ROOT_PARAMETER = 'liwan.telephony.events_key_root'
# A Unix timestamp in decimal digits, and the hex HMAC-SHA256 the signature header carries: nothing else is read.
TIMESTAMP_PATTERN = re.compile(r'^[0-9]{1,20}$')
SIGNATURE_PATTERN = re.compile(r'^[0-9a-fA-F]{64}$')
UNIQUE_VIOLATION = '23505'
# The keys of ``call`` that are a string or null; any other type is a malformed event.
TEXT_FIELDS = ('caller_number', 'connected_number', 'dialed_exten', *TIMESTAMP_FIELDS)
KEY_NOT_CONFIGURED = 'The telephony events key is not configured.'
BAD_TIMESTAMP = 'A valid timestamp is required.'
OUTSIDE_WINDOW = 'The request is outside the accepted clock window.'
BAD_SIGNATURE = 'The signature does not match.'
BAD_RECORDING = 'call.recording must be ready or absent.'
BAD_LINKEDID = 'call.linkedid must be a call id: letters, digits, dot, underscore and dash.'
BAD_DATABASE = 'The event database does not match this tenant.'


class _AlreadyApplied(Exception):
    """Sentinel raised inside a savepoint when a concurrent retry hits the event_id unique constraint."""


def derived_key(root_hex, database, label):
    """The key construction of design 12.6, shared with the agent and with the recording link."""
    return hmac.new(bytes.fromhex(root_hex), (label + '\n' + database).encode(), hashlib.sha256).hexdigest()


def _root():
    # System parameters are readable by base.group_system only and the route runs as the machine identity: the one
    # elevated read before the caller is verified.
    return request.env['ir.config_parameter'].sudo().get_param(KEY_ROOT_PARAMETER) or ''


def _verify(body, timestamp, signature):
    """Refuse with 403, and no traceback, whatever is wrong with the caller's proof.

    A missing, malformed or out-of-range header and a signature that does not match each answer their own fixed
    message, after the key and the timestamp are proven to be well-formed.
    """
    root = _root().strip()
    if not SIGNATURE_PATTERN.fullmatch(root):
        raise ApiError(403, 'forbidden', KEY_NOT_CONFIGURED)
    if not (isinstance(timestamp, str) and TIMESTAMP_PATTERN.fullmatch(timestamp)):
        raise ApiError(403, 'forbidden', BAD_TIMESTAMP)
    try:
        sent = datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        raise ApiError(403, 'forbidden', BAD_TIMESTAMP) from None
    if abs(datetime.now(timezone.utc) - sent) > timedelta(seconds=CLOCK_WINDOW_SECONDS):
        raise ApiError(403, 'forbidden', OUTSIDE_WINDOW)
    if not (isinstance(signature, str) and SIGNATURE_PATTERN.fullmatch(signature)):
        raise ApiError(403, 'forbidden', BAD_SIGNATURE)
    key = derived_key(root, request.env.cr.dbname, EVENTS_LABEL)
    expected = hmac.new(
        bytes.fromhex(key), timestamp.encode('ascii') + b'\n' + body, hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature.lower()):
        raise ApiError(403, 'forbidden', BAD_SIGNATURE)


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _event(raw):
    """The agent's envelope, or 422 ``invalid`` when the body is not one.

    An event carries an ``event_id`` and a ``call`` with a ``linkedid`` the agent's own call-id rule accepts, a known
    direction and state, and a string or null for every party, time and the recording flag.
    """
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ApiError(422, 'invalid', 'The body is not JSON.') from None
    call = payload.get('call') if isinstance(payload, dict) else None
    well_formed = (
        isinstance(payload, dict) and _text(payload.get('event_id'))
        and isinstance(call, dict) and _text(call.get('linkedid'))
        and (payload.get('source') is None or isinstance(payload['source'], str))
    )
    if not well_formed:
        raise ApiError(422, 'invalid', 'An event with an event_id and a call are required.')
    # The agent's delete route refuses a whole request for one id outside its call-id rule, so a stored id
    # outside it could never have its recording deleted: the same rule is read here, before the call exists.
    if LINKEDID_PATTERN.fullmatch(call['linkedid']) is None:
        raise ApiError(422, 'invalid', BAD_LINKEDID, field='linkedid')
    database = payload.get('database')
    if not _text(database):
        raise ApiError(422, 'invalid', 'database must be a non-empty string.', field='database')
    if database != request.env.cr.dbname:
        raise ApiError(403, 'forbidden', BAD_DATABASE)
    if call.get('direction') not in dict(DIRECTIONS) or call.get('state') not in dict(STATES):
        raise ApiError(422, 'invalid', 'The event names an unknown direction or state.')
    for name in TEXT_FIELDS:
        if name not in call or (call[name] is not None and not isinstance(call[name], str)):
            raise ApiError(422, 'invalid', f'call.{name} must be a string or null.', field=name)
    for name in TIMESTAMP_FIELDS:
        if call[name] is not None:
            try:
                parse_iso_timestamp(call[name])
            except ValueError:
                raise ApiError(422, 'invalid', f'call.{name} must be an ISO-8601 datetime or null.', field=name) from None
    # The recording flag is one literal: the agent sends it with the call's final event once the file exists.
    if 'recording' in call and call['recording'] != RECORDING_READY:
        raise ApiError(422, 'invalid', BAD_RECORDING, field='recording')
    return payload


def _event_company(extension_number):
    """The company a new call belongs to: that of the extension the event names, else the tenant's root company."""
    if extension_number:
        extension = request.env['liwan.telephony.extension']._liwan_by_number(extension_number)
        if extension:
            return extension.company_id
    return request.env.company.root_id


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
    @requires_feature(EVENTS_FEATURE, operation='write')
    def receive_event(self, **_):
        """Apply one event, once. The body is the agent's envelope (contracts/src/telephony/event.ts).

        The parties follow the call's direction, which its first event fixes. The call is found, or created under the
        extension's company, and the receipt is written in the same transaction, so a retry that finds the receipt
        changes nothing. An event that carries ``call.recording == 'ready'`` is applied like any other and then
        marks the recording available; it creates the call when the call is not known yet.
        """
        raw = request.httprequest.get_data() or b'{}'
        headers = request.httprequest.headers
        _verify(raw, headers.get(TIMESTAMP_HEADER), headers.get(SIGNATURE_HEADER))
        payload = _event(raw)
        event_id, call = payload['event_id'], payload['call']
        linkedid = call['linkedid']
        env = request.env
        Call = env['liwan.telephony.call']
        record = Call._liwan_by_linkedid(linkedid)
        direction = record.direction if record else call['direction']
        company = record.company_id if record else _event_company(Call._liwan_parties(payload, direction)[1])
        # The receipt lives in the call's company, so the replay check reads it there.
        if env['liwan.telephony.event'].with_company(company).search_count([('event_id', '=', event_id)]):
            return {'applied': False, 'reason': 'already applied'}
        values = Call._liwan_event_values(payload, company, direction)
        try:
            with env.cr.savepoint():
                if record:
                    if call.get('recording') == RECORDING_READY:
                        values.pop('state', None)
                    record._liwan_apply(values)
                else:
                    record = Call.with_company(company).create({'linkedid': linkedid, **values})
                record._liwan_link_participants()
                record.flush_recordset()
                try:
                    with env.cr.savepoint():
                        env['liwan.telephony.event'].with_company(company).create({
                            'event_id': event_id,
                            'linkedid': linkedid,
                            'source': payload.get('source'),
                            'call_id': record.id,
                            'company_id': company.id,
                        })
                except IntegrityError as error:
                    if error.pgcode == UNIQUE_VIOLATION:
                        raise _AlreadyApplied from None
                    raise
        except _AlreadyApplied:
            return {'applied': False, 'reason': 'already applied'}
        return {'applied': True, 'callId': record.id}
