# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso, parse_iso_date, ref
from odoo.addons.liwan_products.models.products_service import (
    QUANTITY_BOUNDS,
    valid_quantity,
)
from odoo.addons.liwan_sales.models.sale_order import (
    DISCOUNT_BOUNDS,
    LINE_KINDS,
    valid_discount,
)

# The wire state of each stock state.
STATE_WIRE = {'draft': 'draft', 'sent': 'sent', 'sale': 'confirmed', 'cancel': 'cancelled'}
WIRE_STATES = {wire: stock for stock, wire in STATE_WIRE.items()}
SOURCES = ('staff', 'online')


def _dump_salesperson(user):
    return {'id': user.id, 'name': user.name, 'user_id': user.id} if user else None


def _dump_line(line):
    # The tax of a line is never read: a branch session cannot read the root company's taxes. Only the stored amounts
    # are, rounded to the currency because a freshly computed one still carries float noise.
    product = line.product_id.product_tmpl_id
    money = line.currency_id.round
    return {
        'id': line.id,
        'kind': LINE_KINDS[line.display_type],
        'product': {'id': product.id, 'name': product.name} if product else None,
        'name': line.name,
        'quantity': line.product_uom_qty,
        'unit': line.product_uom_id.name or None,
        'unit_price': line.price_unit,
        'discount_percent': line.discount,
        'amount_untaxed': money(line.price_subtotal),
        'amount_tax': money(line.price_tax),
        'amount_total': money(line.price_total),
    }


def dump_order_item(order):
    """The order without its lines and actions, as a list row."""
    currency = order.currency_id
    return {
        'id': order.id,
        'number': order.name,
        'state': STATE_WIRE[order.state],
        'locked': bool(order.locked),
        'source': 'staff' if order.liwan_staff_document else 'online',
        'customer': ref(order.partner_id, label='display_name'),
        'salesperson': _dump_salesperson(order.user_id),
        'validity_date': order.validity_date.isoformat() if order.validity_date else None,
        'date': iso(order.date_order),
        'terms': html2plaintext(order.note) if order.note else '',
        'currency': {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol},
        'amount_untaxed': currency.round(order.amount_untaxed),
        'amount_tax': currency.round(order.amount_tax),
        'amount_total': currency.round(order.amount_total),
    }


def dump_order(order, user):
    """The full order shape: the row, its lines in order, and what ``user`` may do with it."""
    return {
        **dump_order_item(order),
        'lines': [_dump_line(line) for line in order.order_line],
        'actions': order._liwan_actions(user),
    }


def dump_orders(orders):
    return [dump_order_item(order) for order in orders]


def parse_order_filters(args):
    """The search domain of the list filters (``q``, ``state`` as one wire state or a comma-separated list, ``source``, ``mine``), or a 422."""
    domain = []
    query = (args.get('q') or '').strip()
    if query:
        domain += ['|', ('name', 'ilike', query), ('partner_id.name', 'ilike', query)]
    state = args.get('state')
    if state:
        wanted = state.split(',')
        if not set(wanted) <= set(WIRE_STATES):
            raise ApiError(422, 'invalid', f'state must be one or more of {tuple(WIRE_STATES)}', field='state')
        domain.append(('state', 'in', [WIRE_STATES[wire] for wire in wanted]))
    source = args.get('source')
    if source:
        if source not in SOURCES:
            raise ApiError(422, 'invalid', f'source must be one of {SOURCES}', field='source')
        domain.append(('liwan_staff_document', '=', source == 'staff'))
    return domain


ORDER_KEYS = ('customer_id', 'salesperson_id', 'validity_date', 'terms', 'lines')
# The keys each kind of line accepts; a price or a tax is never one of them (D6, D8).
LINE_KEYS = {
    'product': ('id', 'kind', 'product_id', 'name', 'quantity', 'discount_percent'),
    'section': ('id', 'kind', 'name'),
    'note': ('id', 'kind', 'name'),
}
ALL_LINE_KEYS = set(LINE_KEYS['product'])
MAX_TERMS = 10_000
MAX_LINE_NAME = 2_000


def _invalid(field, message):
    raise ApiError(422, 'invalid', message, field=field)


def _is_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _refuse_unknown(payload, accepted, prefix=''):
    unknown = sorted(set(payload) - set(accepted))
    if unknown:
        _invalid(f'{prefix}{unknown[0]}', f'field {unknown[0]!r} is not accepted')


def _parse_id(payload, key, field=None):
    value = payload[key]
    if not _is_id(value):
        _invalid(field or key, f'{key} must be a positive integer')
    return value


def _parse_text(value, field, required, maximum):
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > maximum:
        _invalid(field, f'{field} must be {"non-empty " if required else ""}text of at most {maximum} characters')
    return value.strip() if required else value


def _parse_line(index, line):
    """A line entry ``{index, id, kind, product_id, name, quantity, discount}``, or a 422 on ``lines.<index>.<key>``."""
    prefix = f'lines.{index}.'
    if not isinstance(line, dict):
        _invalid(f'lines.{index}', 'a line must be an object')
    _refuse_unknown(line, ALL_LINE_KEYS, prefix)
    kind = line.get('kind')
    if kind not in LINE_KEYS:
        _invalid(f'{prefix}kind', f'kind must be one of {tuple(LINE_KEYS)}')
    _refuse_unknown(line, LINE_KEYS[kind], prefix)
    entry = {'index': index, 'id': None, 'kind': kind, 'name': None}
    if 'id' in line:
        entry['id'] = _parse_id(line, 'id', f'{prefix}id')
    name = line.get('name')
    # An empty name on a product line means "not given": the stock description stays.
    if kind != 'product' or (name is not None and not (isinstance(name, str) and not name.strip())):
        entry['name'] = _parse_text(line.get('name'), f'{prefix}name', required=True, maximum=MAX_LINE_NAME)
    if kind != 'product':
        return entry
    if 'product_id' not in line:
        _invalid(f'{prefix}product_id', 'a product line needs product_id')
    entry['product_id'] = _parse_id(line, 'product_id', f'{prefix}product_id')
    quantity = line.get('quantity')
    if not valid_quantity(quantity):
        _invalid(f'{prefix}quantity', QUANTITY_BOUNDS)
    discount = line.get('discount_percent', 0)
    if not valid_discount(discount):
        _invalid(f'{prefix}discount_percent', DISCOUNT_BOUNDS)
    entry.update(quantity=quantity, discount=discount)
    return entry


def parse_order_body(payload, creating):
    """The whitelisted values of a create (``creating``) or a PATCH, or a 422 naming the field."""
    _refuse_unknown(payload, ORDER_KEYS)
    if creating and 'customer_id' not in payload:
        _invalid('customer_id', 'customer_id is required')
    values = {}
    for key in ('customer_id', 'salesperson_id'):
        if key in payload:
            values[key] = _parse_id(payload, key)
    if 'validity_date' in payload:
        values['validity_date'] = parse_iso_date(payload['validity_date'], 'validity_date')
    if 'terms' in payload:
        values['terms'] = _parse_text(payload['terms'], 'terms', required=False, maximum=MAX_TERMS)
    if 'lines' in payload:
        if not isinstance(payload['lines'], list):
            _invalid('lines', 'lines must be a list')
        values['lines'] = [_parse_line(index, line) for index, line in enumerate(payload['lines'])]
    elif creating:
        values['lines'] = []
    if not values:
        _invalid(None, 'nothing to change')
    return values


def parse_assign_body(payload):
    """The ``salesperson_id`` of an assign, or a 422."""
    _refuse_unknown(payload, ('salesperson_id',))
    if 'salesperson_id' not in payload:
        _invalid('salesperson_id', 'salesperson_id is required')
    return _parse_id(payload, 'salesperson_id')


def dump_salespeople(users):
    return [_dump_salesperson(user) for user in users]
