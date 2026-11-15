# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso, ref
from odoo.addons.liwan_crm.serializers.lists import parse_price
from odoo.addons.liwan_crm.serializers.opportunity import parse_id

NOTE_MAX = 2000
DURATION_MAX_MINUTES = 1440
CALL_FIELDS = ('outcome_id', 'note', 'duration_minutes', 'lost_reason_id')
SALE_FIELDS = ('package_id', 'final_price', 'discount_percent')
# Which customer a sale links its opportunity to when it is not linked yet (neither: the opportunity's own data).
CUSTOMER_FIELDS = ('customer_id', 'create_new')


def dump_call(call):
    return {
        'id': call.id,
        'outcome': ref(call.liwan_outcome_id, label='display_name'),
        'note': call.description or '',
        'duration_minutes': call.duration,
        'user': ref(call.user_id, label='display_name'),
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
    """``package_id``, ``final_price`` and the optional ``discount_percent`` (None: derived) of a sale."""
    missing = [name for name in ('package_id', 'final_price') if name not in payload]
    if missing:
        raise ApiError(422, 'invalid', 'field is required', field=missing[0])
    discount = payload.get('discount_percent')
    return {
        **parse_customer_choice(payload),
        'package_id': parse_id(payload['package_id'], 'package_id'),
        'final_price': parse_price(payload['final_price'], 'final_price'),
        'discount_percent': None if discount is None else _number(discount, 'discount_percent', 0, 100),
    }


def parse_customer_choice(payload):
    """``customer_id`` (an existing customer, or None) and ``create_new`` (``True`` asks for a new one) of a body;
    naming a customer and asking for a new one together is a 422."""
    customer_id = parse_id(payload['customer_id'], 'customer_id') if payload.get('customer_id') is not None else None
    create_new = payload.get('create_new', False)
    if create_new is not False and create_new is not True:
        raise ApiError(422, 'invalid', 'must be true or false', field='create_new')
    if customer_id is not None and create_new:
        raise ApiError(422, 'invalid', 'name a customer or ask for a new one, not both', field='create_new')
    return {'customer_id': customer_id, 'create_new': create_new}


def parse_sale_body(payload):
    _reject_unknown(payload, (*SALE_FIELDS, *CUSTOMER_FIELDS))
    return _parse_sale(payload)


def parse_call_body(payload):
    """The call (``outcome_id``, ``note``, ``duration_minutes``, ``lost_reason_id``) and, when sent, its sale (``sale``)."""
    _reject_unknown(payload, (*CALL_FIELDS, *SALE_FIELDS, *CUSTOMER_FIELDS))
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
        'lost_reason_id': parse_id(payload['lost_reason_id'], 'lost_reason_id') if 'lost_reason_id' in payload else None,
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
