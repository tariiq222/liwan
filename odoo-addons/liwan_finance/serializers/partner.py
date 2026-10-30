# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_ref
from .parsing import parse_bool, parse_id, parse_text, reject_unknown, require_keys

TEXT_FIELDS = ('vat', 'company_registry', 'street', 'city')
ID_FIELDS = ('state_id', 'country_id')
FLAG_FIELDS = ('is_company', 'customer', 'vendor')
WRITABLE = frozenset({'name', *TEXT_FIELDS, *ID_FIELDS, *FLAG_FIELDS})


def dump_partner(partner):
    return {
        'id': partner.id,
        'name': partner.name or '',
        'vat': partner.vat or '',
        'company_registry': partner.company_registry or '',
        'street': partner.street or '',
        'city': partner.city or '',
        'state': dump_ref(partner.state_id),
        'country': dump_ref(partner.country_id),
        'is_company': partner.is_company,
        'customer': partner.customer_rank > 0,
        'vendor': partner.supplier_rank > 0,
        'active': partner.active,
    }


def dump_partners(partners):
    return [dump_partner(partner) for partner in partners]


def _parse_fields(payload):
    """Validate the keys present in ``payload``; relation ids stay ids (None clears them)."""
    parsed = {}
    if 'name' in payload:
        parsed['name'] = parse_text(payload['name'], 'name', required=True)
    for field in TEXT_FIELDS:
        if field in payload:
            parsed[field] = parse_text(payload[field], field)
    for field in ID_FIELDS:
        if field in payload:
            parsed[field] = None if payload[field] is None else parse_id(payload[field], field)
    for field in FLAG_FIELDS:
        if field in payload:
            parsed[field] = parse_bool(payload[field], field)
    return parsed


def parse_partner_create(payload):
    reject_unknown(payload, WRITABLE)
    require_keys(payload, ('name',))
    return _parse_fields(payload)


def parse_partner_patch(payload):
    reject_unknown(payload, WRITABLE)
    return _parse_fields(payload)
