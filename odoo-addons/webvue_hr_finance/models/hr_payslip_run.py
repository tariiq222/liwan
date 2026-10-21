# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

APPROVAL_KEYS = {'webvue_state', 'webvue_approved_by_id', 'webvue_approved_at'}


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

    def _webvue_run_step(self, vals, approver):
        """The (from state, to state) pair that ``vals`` is when it is exactly one of the permitted steps, else None.

        The accounting steps are open to anyone; the two writes of an approval (the engine close, then the approval
        stamp) only to ``approver``.
        """
        keys = set(vals)
        if keys == {'webvue_state', 'webvue_move_id'} and vals['webvue_state'] == 'posted' and vals['webvue_move_id']:
            return ('approved', 'posted')
        if keys == {'webvue_state', 'webvue_payment_id'} and vals['webvue_state'] == 'paid' and vals['webvue_payment_id']:
            return ('posted', 'paid')
        # The engine close comes after the payslips are done, so it is refused on a run whose payslips are not.
        if approver and keys == {'state'} and vals['state'] == 'close' and self._webvue_slips_done():
            return ('computed', 'computed')
        if (
            approver and keys == APPROVAL_KEYS and vals['webvue_state'] == 'approved'
            and vals['webvue_approved_by_id'] == self.env.user.id and vals['webvue_approved_at']
        ):
            return ('computed', 'approved')
        return None

    def _webvue_slips_done(self):
        return all(slip.state == 'done' for run in self for slip in run.slip_ids)

    def write(self, vals):
        """Payroll managers write freely; everyone else only moves a run along its approval and accounting steps."""
        if not self.env.su:
            access = self.env['webvue.access.service']
            if not access._webvue_has_capability(self.env.user, 'hr.payroll.manage'):
                approver = access._webvue_has_capability(self.env.user, 'hr.payroll.approve')
                step = self._webvue_run_step(vals, approver)
                if not step or any(run.webvue_state != step[0] for run in self):
                    raise AccessError(self.env._('Only the approval, the posting and the payment of a payroll run can be written without payroll management.'))
        return super().write(vals)
