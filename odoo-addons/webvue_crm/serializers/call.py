# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_crm.serializers.lists import parse_price
from odoo.addons.webvue_crm.serializers.opportunity import parse_id

NOTE_MAX = 2000
DURATION_MAX_MINUTES = 1440
CALL_FIELDS = ('outcome_id', 'note', 'duration_minutes')
SALE_FIELDS = ('package_id', 'final_price', 'discount_percent')


def _ref(record):
    return {'id': record.id, 'name': record.display_name} if record else None


def dump_call(call):
    return {
        'id': call.id,
        'outcome': _ref(call.webvue_outcome_id),
        'note': call.description or '',
        'duration_minutes': call.duration,
        'user': _ref(call.user_id),
        'created_at': iso(call.date),
    }


def _number(value, field, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ApiError(422, 'invalid', f'must be a number from {low} to {high}', field=field)
    return value


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])


def _parse_sale(payload):
    """``package_id``, ``final_price`` and the optional ``discount_percent`` (default 0) of a sale."""
    missing = [name for name in ('package_id', 'final_price') if name not in payload]
    if missing:
        raise ApiError(422, 'invalid', 'field is required', field=missing[0])
    discount = payload.get('discount_percent')
    return {
        'package_id': parse_id(payload['package_id'], 'package_id'),
        'final_price': parse_price(payload['final_price'], 'final_price'),
        'discount_percent': 0 if discount is None else _number(discount, 'discount_percent', 0, 100),
    }


def parse_sale_body(payload):
    _reject_unknown(payload, SALE_FIELDS)
    return _parse_sale(payload)


def parse_call_body(payload):
    """The call (``outcome_id``, ``note``, ``duration_minutes``) and, when sent, its sale (``sale``)."""
    _reject_unknown(payload, (*CALL_FIELDS, *SALE_FIELDS))
    if 'outcome_id' not in payload:
        raise ApiError(422, 'invalid', 'field is required', field='outcome_id')
    note = payload.get('note')
    if note is not None and (not isinstance(note, str) or len(note) > NOTE_MAX):
        raise ApiError(422, 'invalid', f'must be text of up to {NOTE_MAX} characters', field='note')
    duration = payload.get('duration_minutes')
    return {
        'outcome_id': parse_id(payload['outcome_id'], 'outcome_id'),
        'note': note or None,
        'duration': None if duration is None else _number(duration, 'duration_minutes', 0, DURATION_MAX_MINUTES),
        'sale': _parse_sale(payload) if any(name in payload for name in SALE_FIELDS) else None,
    }


def parse_lost_body(payload):
    _reject_unknown(payload, ('lost_reason_id',))
    if 'lost_reason_id' not in payload:
        raise ApiError(422, 'invalid', 'field is required', field='lost_reason_id')
    return {'lost_reason_id': parse_id(payload['lost_reason_id'], 'lost_reason_id')}


def parse_assign_body(payload):
    _reject_unknown(payload, ('user_id',))
    if 'user_id' not in payload:
        raise ApiError(422, 'invalid', 'field is required', field='user_id')
    return {'user_id': parse_id(payload['user_id'], 'user_id')}
