# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import UNSET, dump_day, dump_number, dump_ref
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
STANDALONE_FIELDS = frozenset({'payment_type', 'partner_type', 'partner_id', 'amount', 'payment_date', 'journal_id', 'payment_method_line_id', 'memo'})
PAYMENT_PATCH_FIELDS = frozenset({'amount', 'payment_date', 'journal_id', 'payment_method_line_id', 'memo'})
ALLOCATE_FIELDS = frozenset({'invoice_ids', 'payment_ids'})
PAYMENT_TYPES = ('inbound', 'outbound')
PARTNER_TYPES = ('customer', 'supplier')
RECEIVABLE_PAYABLE = ('asset_receivable', 'liability_payable')


def counterpart_lines(payment):
    """The journal items of the payment on the partner's receivable or payable account: what is settled or left open."""
    return payment.move_id.line_ids.filtered(lambda line: line.account_id.account_type in RECEIVABLE_PAYABLE)


def allocated_invoices(payment):
    """The invoices the payment is actually set against now, read from its reconciliations (not Odoo's stored link)."""
    lines = counterpart_lines(payment)
    partials = lines.matched_debit_ids | lines.matched_credit_ids
    moves = (partials.debit_move_id | partials.credit_move_id).move_id - payment.move_id
    return moves.filtered(lambda move: move.is_invoice(include_receipts=True))


def unallocated_amount(payment):
    """What the payment still holds open on the partner's account, in the payment currency (zero until it is posted)."""
    if payment.state not in ('in_process', 'paid'):
        return 0.0
    return abs(sum(counterpart_lines(payment).mapped('amount_residual_currency')))


def dump_payment(payment, write_block=UNSET):
    """``write_block`` is the tenant's write refusal when the caller already knows it (a list asks once)."""
    unallocated = payment.currency_id.round(unallocated_amount(payment))
    invoices = allocated_invoices(payment)
    return {
        'id': payment.id,
        'name': dump_number(payment.name),
        'payment_type': payment.payment_type,
        'partner_type': payment.partner_type,
        'state': payment.state,
        'partner': dump_ref(payment.partner_id),
        'journal': dump_ref(payment.journal_id),
        'date': dump_day(payment.date),
        'memo': payment.memo or '',
        'currency': payment.currency_id.name,
        'amount': payment.amount,
        'unallocated': unallocated,
        'invoices': [dump_ref(invoice) for invoice in invoices],
        **payment.env['webvue.finance.actions']._webvue_payment_actions(payment, unallocated, invoices, write_block),
    }


def dump_payments(payments):
    write_block = payments.env['webvue.finance.actions']._webvue_write_block()
    return [dump_payment(payment, write_block) for payment in payments]


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


def _parse_fields(payload):
    parsed = {}
    for field, value in payload.items():
        if field == 'amount':
            parsed[field] = parse_number(value, field, minimum=0, exclusive_minimum=True)
        elif field == 'payment_date':
            parsed[field] = parse_day(value, field)
        elif field == 'memo':
            parsed[field] = parse_text(value, field)
        elif field in ('payment_type', 'partner_type'):
            allowed = PAYMENT_TYPES if field == 'payment_type' else PARTNER_TYPES
            if value not in allowed:
                raise ApiError(422, 'invalid', f'{field} must be one of {", ".join(allowed)}', field=field)
            parsed[field] = value
        else:
            parsed[field] = parse_id(value, field)
    return parsed


def parse_payment_standalone(payload):
    """A receipt (``inbound``, from a customer) or a payment (``outbound``, to a vendor) that names no invoice."""
    reject_unknown(payload, STANDALONE_FIELDS)
    require_keys(payload, ('payment_type', 'partner_id', 'amount', 'payment_date', 'journal_id'))
    return _parse_fields(payload)


def parse_payment_patch(payload):
    reject_unknown(payload, PAYMENT_PATCH_FIELDS)
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')
    return _parse_fields(payload)


def parse_payment_allocation(payload):
    """Exactly one non-empty list: the invoices or the payments the payment is set against."""
    reject_unknown(payload, ALLOCATE_FIELDS)
    given = [field for field in ALLOCATE_FIELDS if payload.get(field)]
    if len(given) != 1:
        raise ApiError(422, 'invalid', 'give either invoice_ids or payment_ids, not both and not neither', field='invoice_ids')
    return {given[0]: parse_id_list(payload[given[0]], given[0])}
