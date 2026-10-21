# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError


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
    webvue_payment_id = fields.Many2one(
        'account.payment', string='Salary payment', copy=False, readonly=True, index='btree_not_null',
        ondelete='restrict',
    )

    def _webvue_accounting_step(self, vals):
        """The (from state, to state) pair that ``vals`` is when it is exactly an accounting step, else None."""
        if set(vals) == {'webvue_state', 'webvue_move_id'} and vals['webvue_state'] == 'posted' and vals['webvue_move_id']:
            return ('approved', 'posted')
        if set(vals) == {'webvue_state', 'webvue_payment_id'} and vals['webvue_state'] == 'paid' and vals['webvue_payment_id']:
            return ('posted', 'paid')
        return None

    def write(self, vals):
        """A user who manages or approves payroll writes freely; an accountant only moves a run along its accounting steps."""
        if not self.env.su:
            access = self.env['webvue.access.service']
            if not any(access._webvue_has_capability(self.env.user, key) for key in ('hr.payroll.manage', 'hr.payroll.approve')):
                step = self._webvue_accounting_step(vals)
                if not step or any(run.webvue_state != step[0] for run in self):
                    raise AccessError(self.env._('Only the posting and the payment of a payroll run can be written without payroll rights.'))
        return super().write(vals)
