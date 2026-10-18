# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref
from .parsing import (
    parse_day,
    parse_id,
    parse_id_list,
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
)
from odoo.addons.webvue_api.controllers.common import ApiError

REGISTER_FIELDS = frozenset({'invoice_ids', 'amount', 'payment_date', 'journal_id', 'payment_method_line_id', 'memo'})


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


def parse_payment_register(payload):
    """Validate a payment registration body (shape only; records are resolved by the route)."""
    reject_unknown(payload, REGISTER_FIELDS)
    require_keys(payload, ('invoice_ids', 'amount', 'payment_date', 'journal_id'))
    invoice_ids = parse_id_list(payload['invoice_ids'], 'invoice_ids')
    if not invoice_ids:
        raise ApiError(422, 'invalid', 'invoice_ids must not be empty', field='invoice_ids')
    parsed = {
        'invoice_ids': invoice_ids,
        'amount': parse_number(payload['amount'], 'amount', minimum=0, exclusive_minimum=True),
        'payment_date': parse_day(payload['payment_date'], 'payment_date'),
        'journal_id': parse_id(payload['journal_id'], 'journal_id'),
    }
    if payload.get('payment_method_line_id') is not None:
        parsed['payment_method_line_id'] = parse_id(payload['payment_method_line_id'], 'payment_method_line_id')
    if 'memo' in payload:
        parsed['memo'] = parse_text(payload['memo'], 'memo')
    return parsed
