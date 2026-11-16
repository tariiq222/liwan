# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError

METHODS = ('order', 'percent', 'amount')
PERCENT_BOUNDS = (1, 100)
MAX_AMOUNT = 1_000_000_000_000


def _invalid(field, message):
    raise ApiError(422, 'invalid', message, field=field)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and abs(value) != float('inf')


def parse_invoice_body(payload):
    """``{method}`` plus ``percent`` or ``amount`` of an invoice request, or a 422 naming the field.

    ``order`` invoices the whole order and takes nothing else; ``percent`` is a down payment of 1 to 100 percent of the order
    total; ``amount`` is a down payment of that total, taxes included, above zero.
    """
    unknown = sorted(set(payload) - {'method', 'percent', 'amount'})
    if unknown:
        _invalid(unknown[0], f'field {unknown[0]!r} is not accepted')
    method = payload.get('method')
    if method not in METHODS:
        _invalid('method', f'method must be one of {METHODS}')
    for key in ('percent', 'amount'):
        if key in payload and key != method:
            _invalid(key, f'{key} belongs to the {key} method only')
    if method == 'order':
        return {'method': method}
    value = payload.get(method)
    if method == 'percent':
        low, high = PERCENT_BOUNDS
        if not _is_number(value) or not low <= value <= high:
            _invalid('percent', f'percent must be a number from {low} to {high}')
    elif not _is_number(value) or not 0 < value <= MAX_AMOUNT:
        _invalid('amount', 'amount must be a number above zero')
    return {'method': method, method: value}
