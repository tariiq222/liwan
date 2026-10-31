# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.serializers.common import iso


def dump_payable_invoice(invoice, status, options):
    """What the token holder of an invoice sees: the merchant, the invoice and how to pay it.

    No partner name, address or internal id beyond the invoice's own. ``options`` are the ones the
    caller computed for a payable invoice, empty otherwise.
    """
    return {
        **_dump_document(invoice, status, options),
        'due_date': fields.Date.to_string(invoice.invoice_date_due) if invoice.invoice_date_due else None,
    }


def dump_payable_order(order, status, options):
    """What the token holder of an online order sees; ``expires_at`` is when an unpaid order is cancelled."""
    return {**_dump_document(order, status, options), 'expires_at': iso(order.liwan_payment_deadline)}


def _dump_document(document, status, options):
    return {
        'id': document.id,
        'merchant': document.company_id.name,
        'number': document.name,
        'currency': document.currency_id.name,
        'amount_total': document.amount_total,
        # A document nobody can pay (cancelled, expired) owes nothing; the payer is told so, not shown a stale amount.
        'amount_due': 0.0 if status == 'not_payable' else document._liwan_pay_amount(),
        'status': status,
        'options': [
            {
                'provider_id': provider.id,
                'provider': provider.name,
                'method_id': method.id,
                'method': method.code,
                'method_name': method.name,
            }
            for provider, method in options
        ],
    }
