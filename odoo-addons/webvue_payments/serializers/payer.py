# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def dump_payable_invoice(invoice, status, options):
    """What the token holder sees: the merchant, the invoice and how to pay it.

    No partner name, address or internal id beyond the invoice's own, and only the options the
    payer may choose while the invoice is payable.
    """
    return {
        'id': invoice.id,
        'merchant': invoice.company_id.name,
        'number': invoice.name,
        'due_date': fields.Date.to_string(invoice.invoice_date_due) if invoice.invoice_date_due else None,
        'currency': invoice.currency_id.name,
        'amount_total': invoice.amount_total,
        'amount_due': invoice.amount_residual,
        'status': status,
        'options': [
            {
                'provider_id': provider.id,
                'provider': provider.name,
                'method_id': method.id,
                'method': method.code,
                'method_name': method.name,
            }
            for provider, method in (options if status == 'payable' else ())
        ],
    }
