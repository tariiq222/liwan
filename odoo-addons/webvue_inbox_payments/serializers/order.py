# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of orders (packages/contracts/src/inbox/catalog.ts)."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.conversation import dump_ref
from odoo.addons.webvue_inbox_payments.models.order import UNREAD


def dump_payment(payment):
    if not payment:
        return None
    return {
        'status': payment['status'],
        'refund_due': payment['refund_due'],
        'needs_attention': payment['needs_attention'],
        'currency': payment['currency'],
        'amount_total': payment['amount_total'],
        'amount_due': payment['amount_due'],
        'expires_at': iso(payment['expires_at']),
    }


def dump_order_line(line, agent_built):
    item = line.catalog_item_id
    return {
        'id': line.id,
        'product_retailer_id': line.retailer_id,
        'catalog_item_id': item.id or None,
        'name': item.name if item else None,
        'quantity': line.quantity,
        'cart_price': None if agent_built else line.cart_price,
        'unit_price': line._webvue_unit_price(),
        'currency': line.currency,
        'availability': item.availability if item else None,
    }


def dump_order(order, payment=UNREAD):
    """The order's wire shape; `payment` is its already read payment facts (read once here when not given)."""
    conversation = order.conversation_id
    payment = order._webvue_payment() if payment is UNREAD else payment
    agent_built = not order.message_id
    return {
        'id': order.id,
        'conversation_id': conversation.id,
        'channel': dump_ref(conversation.channel_id),
        'contact': dump_ref(conversation.contact_id),
        'message_id': order.message_id.id or None,
        'state': order.state,
        'reference': order.reference or None,
        'lines': [dump_order_line(line, agent_built) for line in order.line_ids],
        'cart_total': None if agent_built else order.cart_total,
        'cart_currency': None if agent_built else order.cart_currency,
        'total': order._webvue_total(payment),
        'currency': order._webvue_currency(),
        'price_changed': order._webvue_price_changed(payment),
        'payment': dump_payment(payment),
        'pay_link_sent_at': iso(order.pay_link_sent_at),
        'created_by': dump_ref(order.created_by_id),
        'created_at': iso(order.create_date),
    }
