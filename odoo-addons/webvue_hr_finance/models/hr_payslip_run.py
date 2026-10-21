# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class HrPayslipRun(models.Model):
    """The accounting side of a payroll run: the states after approval and the entry that books it."""

    _inherit = 'hr.payslip.run'

    webvue_state = fields.Selection(
        selection_add=[('posted', 'Posted'), ('paid', 'Paid')],
        ondelete={
            'posted': lambda runs: runs.write({'webvue_state': 'approved'}),
            'paid': lambda runs: runs.write({'webvue_state': 'approved'}),
        },
    )
    webvue_move_id = fields.Many2one(
        'account.move', string='Journal entry', copy=False, readonly=True, index='btree_not_null',
        ondelete='restrict',
    )
