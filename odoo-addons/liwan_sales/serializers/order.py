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
from odoo.addons.liwan_sales.serializers.parsing import (
    invalid,
    parse_id,
    parse_text,
    refuse_unknown,
)

# The wire state of each stock state.
STATE_WIRE = {'draft': 'draft', 'sent': 'sent', 'sale': 'confirmed', 'cancel': 'cancelled'}
WIRE_STATES = {wire: stock for stock, wire in STATE_WIRE.items()}
SOURCES = ('staff', 'online')


def _dump_salesperson(user):
    return {'id': user.id, 'name': user.name, 'user_id': user.id} if user else None


def dump_currency(currency):
    return {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol}


def dump_line_values(line):
    """What a line shows on every page: its kind, name, quantity, unit, price, discount and amounts.

    The tax of a line is never read: a branch session cannot read the root company's taxes. Only the stored amounts
    are, rounded to the currency because a freshly computed one still carries float noise.
    """
    money = line.currency_id.round
    return {
        'kind': LINE_KINDS[line.display_type],
        'name': line.name,
        'quantity': line.product_uom_qty,
        'unit': line.product_uom_id.name or None,
        'unit_price': line.price_unit,
        'discount_percent': line.discount,
        'amount_untaxed': money(line.price_subtotal),
        'amount_tax': money(line.price_tax),
        'amount_total': money(line.price_total),
    }


def _dump_line(line):
    product = line.product_id.product_tmpl_id
    return {
        'id': line.id,
        'product': {'id': product.id, 'name': product.name} if product else None,
        **dump_line_values(line),
    }


def dump_customer_answer(order):
    """What the customer was offered and has answered, or None before the first send."""
    if not order.liwan_answer_mode:
        return None
    return {
        'mode': order.liwan_answer_mode,
        'acceptance_confirms': order.liwan_acceptance_confirms,
        'answer': order.liwan_answer or None,
        'answered_at': iso(order.liwan_answered_on),
        'signed_by': order.signed_by or None,
        'signature_method': order.liwan_signature_method or None,
        'decline_reason': order.liwan_decline_reason or None,
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
        'currency': dump_currency(currency),
        'amount_untaxed': currency.round(order.amount_untaxed),
        'amount_tax': currency.round(order.amount_tax),
        'amount_total': currency.round(order.amount_total),
        'expired': bool(order.is_expired),
        'customer_answer': dump_customer_answer(order),
    }


def dump_order(order, user):
    """The full order shape: the row, its lines in order, what ``user`` may do with it, and whether only the tenant's
    resend setting keeps them from sending it."""
    return {
        **dump_order_item(order),
        'lines': [_dump_line(line) for line in order._liwan_lines()],
        'actions': order._liwan_actions(user),
        'resend_refused': order._liwan_resend_blocked(user),
        **order._liwan_staff_extras(user),
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


# ``template_id`` starts a quotation from a quotation template; it is a create key only.
ORDER_KEYS = ('customer_id', 'salesperson_id', 'validity_date', 'terms', 'lines', 'template_id')
# The keys each kind of line accepts; a price or a tax is never one of them (D6, D8).
LINE_KEYS = {
    'product': ('id', 'kind', 'product_id', 'name', 'quantity', 'discount_percent'),
    'section': ('id', 'kind', 'name'),
    'note': ('id', 'kind', 'name'),
}
ALL_LINE_KEYS = set(LINE_KEYS['product'])
MAX_TERMS = 10_000
MAX_LINE_NAME = 2_000


def _parse_line(index, line):
    """A line entry ``{index, id, kind, product_id, name, quantity, discount}``, or a 422 on ``lines.<index>.<key>``."""
    prefix = f'lines.{index}.'
    if not isinstance(line, dict):
        invalid(f'lines.{index}', 'a line must be an object')
    refuse_unknown(line, ALL_LINE_KEYS, prefix)
    kind = line.get('kind')
    if kind not in LINE_KEYS:
        invalid(f'{prefix}kind', f'kind must be one of {tuple(LINE_KEYS)}')
    refuse_unknown(line, LINE_KEYS[kind], prefix)
    entry = {'index': index, 'id': None, 'kind': kind, 'name': None}
    if 'id' in line:
        entry['id'] = parse_id(line, 'id', f'{prefix}id')
    name = line.get('name')
    # An empty name on a product line means "not given": the stock description stays.
    if kind != 'product' or (name is not None and not (isinstance(name, str) and not name.strip())):
        entry['name'] = parse_text(line.get('name'), f'{prefix}name', required=True, maximum=MAX_LINE_NAME)
    if kind != 'product':
        return entry
    if 'product_id' not in line:
        invalid(f'{prefix}product_id', 'a product line needs product_id')
    entry['product_id'] = parse_id(line, 'product_id', f'{prefix}product_id')
    quantity = line.get('quantity')
    if not valid_quantity(quantity):
        invalid(f'{prefix}quantity', QUANTITY_BOUNDS)
    discount = line.get('discount_percent', 0)
    if not valid_discount(discount):
        invalid(f'{prefix}discount_percent', DISCOUNT_BOUNDS)
    entry.update(quantity=quantity, discount=discount)
    return entry


def parse_order_body(payload, creating, parsers):
    """The whitelisted values of a create (``creating``) or a PATCH, or a 422 naming the field.

    ``parsers`` are the keys an installed bridge adds (``liwan.sales.service._liwan_order_parsers``), each with the
    function that checks its value; they come back in ``values['extras']``.
    """
    refuse_unknown(payload, (*ORDER_KEYS, *parsers))
    if creating and 'customer_id' not in payload:
        invalid('customer_id', 'customer_id is required')
    values = {}
    for key in ('customer_id', 'salesperson_id'):
        if key in payload:
            values[key] = parse_id(payload, key)
    if 'template_id' in payload:
        if not creating:
            invalid('template_id', 'a template starts a quotation: it is given when the quotation is created')
        if 'lines' in payload:
            invalid('template_id', 'give the lines or a template, not both')
        values['template_id'] = parse_id(payload, 'template_id')
    if 'validity_date' in payload:
        values['validity_date'] = parse_iso_date(payload['validity_date'], 'validity_date')
    if 'terms' in payload:
        values['terms'] = parse_text(payload['terms'], 'terms', required=False, maximum=MAX_TERMS)
    if 'lines' in payload:
        if not isinstance(payload['lines'], list):
            invalid('lines', 'lines must be a list')
        values['lines'] = [_parse_line(index, line) for index, line in enumerate(payload['lines'])]
    elif creating and 'template_id' not in payload:
        values['lines'] = []
    extras = {key: parser(payload[key]) for key, parser in parsers.items() if key in payload}
    if extras:
        values['extras'] = extras
    if not values:
        invalid(None, 'nothing to change')
    return values


def parse_assign_body(payload):
    """The ``salesperson_id`` of an assign, or a 422."""
    refuse_unknown(payload, ('salesperson_id',))
    if 'salesperson_id' not in payload:
        invalid('salesperson_id', 'salesperson_id is required')
    return parse_id(payload, 'salesperson_id')


def dump_salespeople(users):
    return [_dump_salesperson(user) for user in users]
