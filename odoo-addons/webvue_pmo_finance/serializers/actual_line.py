# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

# The finance record kind (a record link of the web finance application) of each journal entry type.
RECORD_KINDS = {
    'out_invoice': 'finance-invoice',
    'out_refund': 'finance-credit-note',
    'in_invoice': 'finance-bill',
    'in_refund': 'finance-refund',
    'entry': 'finance-entry',
}


def dump_actual_line(line):
    """One posted expense item of a cost center; ``amount`` is the cost, so a refund is negative."""
    move = line.move_line_id.move_id
    return {
        'id': line.id,
        'date': fields.Date.to_string(line.date),
        'label': line.name or '',
        'reference': line.ref or None,
        'partner': {'id': line.partner_id.id, 'name': line.partner_id.name} if line.partner_id else None,
        'amount': -line.amount,
        'record': {'kind': RECORD_KINDS[move.move_type], 'id': move.id} if move.move_type in RECORD_KINDS else None,
    }
