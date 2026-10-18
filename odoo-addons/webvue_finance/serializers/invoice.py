# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref


def dump_invoice(move):
    return {
        'id': move.id,
        'name': move.name,
        'move_type': move.move_type,
        'state': move.state,
        'payment_state': move.payment_state,
        'partner': dump_ref(move.partner_id),
        'journal': dump_ref(move.journal_id),
        'invoice_date': dump_day(move.invoice_date),
        'invoice_date_due': dump_day(move.invoice_date_due),
        'currency': move.currency_id.name,
        'amount_untaxed': move.amount_untaxed,
        'amount_tax': move.amount_tax,
        'amount_total': move.amount_total,
        'amount_residual': move.amount_residual,
    }


def dump_invoice_line(line):
    return {
        'id': line.id,
        'name': line.name or '',
        'account': dump_ref(line.account_id),
        'quantity': line.quantity,
        'price_unit': line.price_unit,
        'discount': line.discount,
        'taxes': [dump_ref(tax) for tax in line.tax_ids],
        'price_subtotal': line.price_subtotal,
        'price_total': line.price_total,
    }


def dump_invoice_detail(move):
    return {
        **dump_invoice(move),
        'ref': move.ref or '',
        'lines': [dump_invoice_line(line) for line in move.invoice_line_ids],
    }


def dump_invoices(moves):
    return [dump_invoice(move) for move in moves]
