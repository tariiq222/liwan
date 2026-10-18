# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref


def dump_payment(payment):
    return {
        'id': payment.id,
        'name': payment.name or '',
        'payment_type': payment.payment_type,
        'partner_type': payment.partner_type,
        'state': payment.state,
        'partner': dump_ref(payment.partner_id),
        'journal': dump_ref(payment.journal_id),
        'date': dump_day(payment.date),
        'memo': payment.memo or '',
        'currency': payment.currency_id.name,
        'amount': payment.amount,
    }


def dump_payments(payments):
    return [dump_payment(payment) for payment in payments]
