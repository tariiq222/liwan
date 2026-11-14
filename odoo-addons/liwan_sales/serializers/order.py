# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso

# The wire state of each stock state.
STATE_WIRE = {'draft': 'draft', 'sent': 'sent', 'sale': 'confirmed', 'cancel': 'cancelled'}
WIRE_STATES = {wire: stock for stock, wire in STATE_WIRE.items()}
SOURCES = ('staff', 'online')
BOOLEANS = {'true': True, 'false': False}
# A subsection is reported as a section.
LINE_KINDS = {False: 'product', 'line_section': 'section', 'line_subsection': 'section', 'line_note': 'note'}


def _ref(record):
    return {'id': record.id, 'name': record.display_name}


def _dump_salesperson(user):
    return {'id': user.id, 'name': user.name, 'user_id': user.id} if user else None


def _dump_line(line):
    # The tax of a line is never read: a branch session cannot read the root company's taxes. Only the stored amounts
    # are.
    product = line.product_id.product_tmpl_id
    return {
        'id': line.id,
        'kind': LINE_KINDS[line.display_type],
        'product': {'id': product.id, 'name': product.name} if product else None,
        'name': line.name,
        'quantity': line.product_uom_qty,
        'unit': line.product_uom_id.name or None,
        'unit_price': line.price_unit,
        'discount_percent': line.discount,
        'amount_untaxed': line.price_subtotal,
        'amount_tax': line.price_tax,
        'amount_total': line.price_total,
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
        'customer': _ref(order.partner_id),
        'salesperson': _dump_salesperson(order.user_id),
        'validity_date': order.validity_date.isoformat() if order.validity_date else None,
        'date': iso(order.date_order),
        'terms': html2plaintext(order.note) if order.note else '',
        'currency': {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol},
        'amount_untaxed': order.amount_untaxed,
        'amount_tax': order.amount_tax,
        'amount_total': order.amount_total,
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
    """The search domain of the list filters (``q``, ``state``, ``source``, ``mine``), or a 422."""
    domain = []
    query = (args.get('q') or '').strip()
    if query:
        domain += ['|', ('name', 'ilike', query), ('partner_id.name', 'ilike', query)]
    state = args.get('state')
    if state:
        if state not in WIRE_STATES:
            raise ApiError(422, 'invalid', f'state must be one of {tuple(WIRE_STATES)}', field='state')
        domain.append(('state', '=', WIRE_STATES[state]))
    source = args.get('source')
    if source:
        if source not in SOURCES:
            raise ApiError(422, 'invalid', f'source must be one of {SOURCES}', field='source')
        domain.append(('liwan_staff_document', '=', source == 'staff'))
    return domain


def parse_mine(args):
    """Whether the list is limited to the caller's own orders, or a 422."""
    raw = args.get('mine')
    if raw is None:
        return False
    if raw not in BOOLEANS:
        raise ApiError(422, 'invalid', 'mine must be true or false', field='mine')
    return BOOLEANS[raw]
