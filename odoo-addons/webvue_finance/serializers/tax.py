# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_ref
from .parsing import (
    parse_bool,
    parse_id,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
    require_nonempty,
)
from odoo.addons.webvue_api.controllers.common import ApiError

TAX_USES = ('sale', 'purchase')
TAX_AMOUNT_TYPES = ('percent', 'fixed')
TAX_CREATE_FIELDS = frozenset({'name', 'type_tax_use', 'amount_type', 'amount', 'price_include', 'tax_account_id'})
# What a posted document was computed with never changes; the name and the invoice label stay editable.
TAX_PATCH_FIELDS = TAX_CREATE_FIELDS
TAX_LOCKED_WHEN_USED = ('type_tax_use', 'amount_type', 'amount', 'price_include', 'tax_account_id')


def tax_account_of(tax):
    """The account that holds the tax amount (the invoice tax line's account), empty when it follows the base line."""
    return tax.invoice_repartition_line_ids.filtered(lambda line: line.repartition_type == 'tax')[:1].account_id


def dump_tax(tax):
    return {
        'id': tax.id,
        'name': tax.name,
        'type_tax_use': tax.type_tax_use,
        'amount_type': tax.amount_type,
        'amount': tax.amount,
        'price_include': tax.price_include,
        'tax_account': dump_ref(tax_account_of(tax)),
        'active': tax.active,
        'used': tax.is_used,
    }


def dump_taxes(taxes):
    return [dump_tax(tax) for tax in taxes]


def _parse_fields(payload):
    parsed = {}
    for field, value in payload.items():
        if field == 'name':
            parsed[field] = parse_text(value, field, required=True)
        elif field in ('type_tax_use', 'amount_type'):
            allowed = TAX_USES if field == 'type_tax_use' else TAX_AMOUNT_TYPES
            if value not in allowed:
                raise ApiError(422, 'invalid', f'{field} must be one of {", ".join(allowed)}', field=field)
            parsed[field] = value
        elif field == 'tax_account_id':
            parsed[field] = parse_id(value, field)
        elif field == 'amount':
            parsed[field] = parse_number(value, field, minimum=0)
        else:
            parsed[field] = parse_bool(value, field)
    return parsed


def parse_tax_create(payload):
    reject_unknown(payload, TAX_CREATE_FIELDS)
    # The account is required: without one the tax amount would be booked on the expense or income account of the line.
    require_keys(payload, ('name', 'type_tax_use', 'amount', 'tax_account_id'))
    return _parse_fields(payload)


def parse_tax_patch(payload):
    reject_unknown(payload, TAX_PATCH_FIELDS)
    require_nonempty(payload)
    return _parse_fields(payload)
