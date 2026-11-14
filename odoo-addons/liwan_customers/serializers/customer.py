# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_api.serializers.properties import (
    dump_record_properties,
    filter_domain,
)
from odoo.addons.liwan_customers.models.customers_settings import PROPERTIES_FIELD
from odoo.addons.liwan_customers.models.privacy_hooks import is_erased

CREATE_KEYS = frozenset({'name', 'phone', 'email', 'is_company', 'parent_id', 'properties', 'create_new'})
PATCH_KEYS = CREATE_KEYS - {'create_new'}
NULLABLE_TEXT = ('phone', 'email')
# A query argument ``property.<key>=<raw>`` filters the list by a custom field.
PROPERTY_PREFIX = 'property.'
TRUE_VALUES = ('1', 'true')


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_customer(partner):
    """A party on the wire: its identity, its parent company customer and its owning branch (null when shared), and
    the tenant's customer fields in their order with the party's value. ``erased`` is true for a party whose personal data
    was erased: its stored ``name`` is then a language-neutral marker, and the client shows a translated one. Only a
    party is ever dumped."""
    return {
        'id': partner.id,
        'name': partner.name,
        'erased': is_erased(partner),
        'phone': partner.phone or None,
        'email': partner.email or None,
        'is_company': partner.is_company,
        'parent': _ref(partner.parent_id),
        'active': partner.active,
        'company': _ref(partner.company_id),
        'properties': dump_record_properties(partner, PROPERTIES_FIELD),
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
    if 'properties' in payload:
        if not isinstance(payload['properties'], dict):
            raise ApiError(422, 'invalid', 'properties must be an object', field='properties')
        values['properties'] = payload['properties']
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


def parse_list_filters(args, definition):
    """``(query, archived, filters)`` of the directory list and export: the search text ``q``, ``archived``, and a
    domain leaf for every ``property.<key>`` argument (checked against the tenant's ``definition``) and for
    ``is_company=true|false``."""
    archived = args.get('archived', 'false').lower() in TRUE_VALUES
    filters = [
        filter_domain(PROPERTIES_FIELD, definition, name[len(PROPERTY_PREFIX):], args[name])
        for name in args if name.startswith(PROPERTY_PREFIX)
    ]
    if 'is_company' in args:
        if args['is_company'] not in ('true', 'false'):
            raise ApiError(422, 'invalid', 'is_company must be true or false', field='is_company')
        filters.append(('is_company', '=', args['is_company'] == 'true'))
    return args.get('q') or None, archived, filters
