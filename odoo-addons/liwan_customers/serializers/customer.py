# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int

CREATE_KEYS = frozenset({'name', 'phone', 'email', 'is_company', 'parent_id', 'create_new'})
PATCH_KEYS = CREATE_KEYS - {'create_new'}
NULLABLE_TEXT = ('phone', 'email')


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_customer(partner):
    """A party on the wire: its identity, its parent company customer and its owning branch (null when shared)."""
    return {
        'id': partner.id,
        'name': partner.name,
        'phone': partner.phone or None,
        'email': partner.email or None,
        'is_company': partner.is_company,
        'parent': _ref(partner.parent_id),
        'active': partner.active,
        'company': _ref(partner.company_id),
    }


def dump_customers(partners, total):
    return {'items': [dump_customer(partner) for partner in partners], 'total': total}


def _identity_values(payload, keys):
    unknown = sorted(set(payload) - keys)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    values = {}
    if 'name' in payload:
        if not isinstance(payload['name'], str):
            raise ApiError(422, 'invalid', 'name must be a string', field='name')
        values['name'] = payload['name']
    for key in NULLABLE_TEXT:
        if key in payload:
            if payload[key] is not None and not isinstance(payload[key], str):
                raise ApiError(422, 'invalid', f'{key} must be a string or null', field=key)
            values[key] = payload[key]
    if 'is_company' in payload:
        if not isinstance(payload['is_company'], bool):
            raise ApiError(422, 'invalid', 'is_company must be a boolean', field='is_company')
        values['is_company'] = payload['is_company']
    if 'parent_id' in payload:
        parent_id = payload['parent_id']
        values['parent_id'] = None if parent_id is None else parse_positive_int(parent_id, 'parent_id')
    return values


def parse_customer_create(payload):
    """``(values, create_new)`` of a new customer; ``name`` is required."""
    if 'name' not in payload:
        raise ApiError(422, 'invalid', 'name is required', field='name')
    create_new = payload.get('create_new', False)
    if not isinstance(create_new, bool):
        raise ApiError(422, 'invalid', 'create_new must be a boolean', field='create_new')
    return _identity_values(payload, CREATE_KEYS), create_new


def parse_customer_patch(payload):
    values = _identity_values(payload, PATCH_KEYS)
    if not values:
        raise ApiError(422, 'invalid', 'nothing to change')
    return values
