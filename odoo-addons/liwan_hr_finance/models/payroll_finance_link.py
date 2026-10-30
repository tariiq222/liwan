# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanHrPayrollFinanceLink(models.AbstractModel):
    """The finance bridge answers the hooks of the payroll run: the actions it offers and its entry."""

    _inherit = 'liwan.hr.payroll.finance.link'

    def _liwan_can(self, capability):
        return self.env['liwan.access.service']._liwan_has_capability(self.env.user, capability)

    def _liwan_can_name_payment(self):
        return self._liwan_can('finance.payments.read') or self._liwan_can('finance.entries.read')

    @api.model
    def _liwan_finance_actions(self, run):
        actions = super()._liwan_finance_actions(run)
        # Every finance action writes accounting records: none is offered while the finance feature is off.
        if not self.env['liwan.entitlement.service']._liwan_feature_write('finance.enabled'):
            return actions
        if run.liwan_state == 'approved' and self._liwan_can('finance.entries.post'):
            actions.append('post')
        if run.liwan_state == 'posted' and self._liwan_can('finance.payments.manage'):
            actions.append('record_payment')
        if run.liwan_state in ('posted', 'paid') and self._liwan_can('finance.entries.post'):
            actions.append('eos_provision')
        return actions

    @api.model
    def _liwan_finance_refs(self, run):
        refs = super()._liwan_finance_refs(run)
        if not run.liwan_move_id:
            return refs
        return {
            'entry_id': run.liwan_move_id.id,
            'entry_name': run.liwan_move_id.name if self._liwan_can('finance.entries.read') else None,
            'payment_id': run.liwan_payment_id.id or None,
            'payment_name': run.liwan_payment_id.name if run.liwan_payment_id and self._liwan_can_name_payment() else None,
        }
