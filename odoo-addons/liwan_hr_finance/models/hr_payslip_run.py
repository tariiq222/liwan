# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

APPROVAL_KEYS = {'liwan_state', 'liwan_approved_by_id', 'liwan_approved_at'}
# What the record each accounting step links the run to must be: the run's entry, or a payment's entry.
POSTED_MOVE_ORIGIN = 'run'
PAID_MOVE_ORIGIN = 'payment'


class HrPayslipRun(models.Model):
    """The accounting side of a payroll run: the states after approval and the entry that books it."""

    _inherit = 'hr.payslip.run'

    liwan_state = fields.Selection(
        selection_add=[('posted', 'Posted'), ('paid', 'Paid')],
        ondelete={
            'posted': lambda runs: runs.write({'liwan_state': 'approved'}),
            'paid': lambda runs: runs.write({'liwan_state': 'approved'}),
        },
    )
    liwan_move_id = fields.Many2one(
        'account.move', string='Journal entry', copy=False, readonly=True, index='btree_not_null',
        ondelete='restrict',
    )
    liwan_payment_id = fields.Many2one(
        'account.payment', string='Salary payment', copy=False, readonly=True, index='btree_not_null',
        ondelete='restrict',
    )

    def _liwan_linkable(self, model, value):
        """The record of ``model`` the written value names among the records the caller may read, else empty."""
        if not isinstance(value, int):
            return self.env[model]
        return self.env[model].search([('id', '=', value)], limit=1)

    def _liwan_same_company(self, record):
        """True when ``record`` exists and every run written belongs to its company."""
        return bool(record) and all(run.company_id == record.company_id for run in self)

    def _liwan_run_step(self, vals, approver):
        """The (from state, to state) pair that ``vals`` is when it is exactly one of the permitted steps, else None.

        The accounting steps are open to anyone; the two writes of an approval (the engine close, then the approval
        stamp) only to ``approver``. An accounting step only counts when it links the run to the record the step
        books: a posted entry made by a payroll run, or an entry made by a payroll payment, in the run's company.
        """
        keys = set(vals)
        if keys == {'liwan_state', 'liwan_move_id'} and vals['liwan_state'] == 'posted':
            move = self._liwan_linkable('account.move', vals['liwan_move_id'])
            if (
                move.liwan_payroll_origin == POSTED_MOVE_ORIGIN and move.state == 'posted'
                and self._liwan_same_company(move)
            ):
                return ('approved', 'posted')
        if keys == {'liwan_state', 'liwan_payment_id'} and vals['liwan_state'] == 'paid':
            payment = self._liwan_linkable('account.payment', vals['liwan_payment_id'])
            if payment.move_id.liwan_payroll_origin == PAID_MOVE_ORIGIN and self._liwan_same_company(payment):
                return ('posted', 'paid')
        # The engine close comes after the payslips are done, so it is refused on a run whose payslips are not.
        if approver and keys == {'state'} and vals['state'] == 'close' and self._liwan_slips_done():
            return ('computed', 'computed')
        if (
            approver and keys == APPROVAL_KEYS and vals['liwan_state'] == 'approved'
            and vals['liwan_approved_by_id'] == self.env.user.id and vals['liwan_approved_at']
        ):
            return ('computed', 'approved')
        return None

    def _liwan_slips_done(self):
        return all(slip.state == 'done' for run in self for slip in run.slip_ids)

    def write(self, vals):
        """Payroll managers write freely; everyone else only moves a run along its approval and accounting steps."""
        if not self.env.su:
            access = self.env['liwan.access.service']
            if not access._liwan_has_capability(self.env.user, 'hr.payroll.manage'):
                approver = access._liwan_has_capability(self.env.user, 'hr.payroll.approve')
                step = self._liwan_run_step(vals, approver)
                if not step or any(run.liwan_state != step[0] for run in self):
                    raise AccessError(self.env._('Only the approval, the posting and the payment of a payroll run can be written without payroll management.'))
        return super().write(vals)
