# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError

# The wire vocabulary of the price mode, and the stock selection each value means.
PRICE_MODE_BY_WIRE = {'included': 'tax_included', 'added': 'tax_excluded'}
PRICE_MODE_BY_STOCK = {stock: wire for wire, stock in PRICE_MODE_BY_WIRE.items()}
PATCH_KEYS = frozenset({'registered', 'price_mode'})


def dump_company_tax(values, session_company, can_change):
    """The establishment's tax answer from ``_liwan_establishment_values``; never a raw ORM read."""
    registered = values['registered']
    price_mode = PRICE_MODE_BY_STOCK[values['account_price_include']]
    return {
        'registered': registered,
        'price_mode': price_mode,
        'choice': price_mode if registered else 'none',
        'locked': values['locked'],
        'can_change': bool(can_change),
        'is_root_session': session_company.root_id == session_company,
    }


def parse_company_tax_patch(payload):
    """Validate a PATCH body: ``registered`` and/or ``price_mode``, nothing else."""
    unknown = set(payload) - PATCH_KEYS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'invalid', 'field is not accepted', field=field)
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')
    parsed = {}
    if 'registered' in payload:
        if type(payload['registered']) is not bool:
            raise ApiError(422, 'invalid', 'registered must be a boolean', field='registered')
        parsed['registered'] = payload['registered']
    if 'price_mode' in payload:
        price_mode = payload['price_mode']
        if not isinstance(price_mode, str) or price_mode not in PRICE_MODE_BY_WIRE:
            raise ApiError(422, 'invalid', 'price_mode must be included or added', field='price_mode')
        parsed['price_mode'] = PRICE_MODE_BY_WIRE[price_mode]
    return parsed
