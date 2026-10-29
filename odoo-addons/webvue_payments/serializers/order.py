# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What payments staff see of the company's online orders, and the refund they record.

Every shape is built from ``webvue.payments.service`` facts: staff hold no sales rights, so the
service reads the orders elevated and this module lists exactly what leaves the server.
"""
import math

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso

# The order states staff filter on, by their wire name.
STATE_FILTERS = {'open': ('draft', 'sent'), 'confirmed': ('sale',), 'cancelled': ('cancel',)}
FLAGS = {'true': True, 'false': False}
REFUND_FIELDS = {'amount', 'reference'}
MAX_REFERENCE_LENGTH = 128


def dump_order_item(service, order):
    """One row of the staff orders list."""
    row = service._webvue_order_row(order)
    return {'id': order.id, **row, 'date': iso(row['date']), 'expires_at': iso(row['expires_at'])}


def dump_order_detail(service, order):
    """The staff order page: the row, its lines, every payment and refund, and whether partial refunds are allowed."""
    details = service._webvue_order_details(order)
    return {
        **dump_order_item(service, order),
        'lines': [
            {'name': line.name, 'quantity': line.product_uom_qty, 'amount': line.price_total}
            for line in details['lines']
        ],
        'transactions': [_dump_transaction(tx) for tx in details['transactions']],
        'partial_refunds': details['partial_refunds'],
    }


def _dump_transaction(tx):
    refund = tx.operation == 'refund'
    return {
        'id': tx.id,
        'kind': 'refund' if refund else 'payment',
        'state': tx.state,
        'amount': abs(tx.amount),
        'provider': tx.provider_id.name,
        'reference': tx.provider_reference or '',
        'date': iso(tx.last_state_change),
    }


def parse_order_filters(args):
    """The list filters of a query string: ``refund_due``, ``needs_attention`` (true/false) and ``state``."""
    filters = {}
    for field in ('refund_due', 'needs_attention'):
        if field in args:
            if args[field] not in FLAGS:
                raise ApiError(422, 'invalid', 'must be true or false', field=field)
            filters[field] = FLAGS[args[field]]
    if 'state' in args:
        if args['state'] not in STATE_FILTERS:
            raise ApiError(422, 'invalid', 'must be one of %s' % ', '.join(sorted(STATE_FILTERS)), field='state')
        filters['states'] = STATE_FILTERS[args['state']]
    return filters


def parse_refund(payload):
    """A refund body: ``amount`` (a positive number) and ``reference``, the gateway's refund reference."""
    unknown = sorted(set(payload) - REFUND_FIELDS)
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    amount = payload.get('amount')
    if type(amount) not in (int, float) or not math.isfinite(amount) or amount <= 0:
        raise ApiError(422, 'invalid', 'must be a positive amount', field='amount')
    reference = payload.get('reference')
    if not isinstance(reference, str) or not reference.strip() or len(reference) > MAX_REFERENCE_LENGTH:
        raise ApiError(422, 'invalid', 'must be the gateway refund reference, at most %d characters' % MAX_REFERENCE_LENGTH, field='reference')
    return {'amount': float(amount), 'reference': reference.strip()}
