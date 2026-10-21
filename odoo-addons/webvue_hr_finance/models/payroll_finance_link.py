# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueHrPayrollFinanceLink(models.AbstractModel):
    """The finance bridge answers the hooks of the payroll run: the actions it offers and its entry."""

    _inherit = 'webvue.hr.payroll.finance.link'

    def _webvue_can(self, capability):
        return self.env['webvue.access.service']._webvue_has_capability(self.env.user, capability)

    def _webvue_can_name_payment(self):
        return self._webvue_can('finance.payments.read') or self._webvue_can('finance.entries.read')

    @api.model
    def _webvue_finance_actions(self, run):
        actions = super()._webvue_finance_actions(run)
        if run.webvue_state == 'approved' and self._webvue_can('finance.entries.post'):
            actions.append('post')
        if run.webvue_state == 'posted' and self._webvue_can('finance.payments.manage'):
            actions.append('record_payment')
        if run.webvue_state in ('posted', 'paid') and self._webvue_can('finance.entries.post'):
            actions.append('eos_provision')
        return actions

    @api.model
    def _webvue_finance_refs(self, run):
        refs = super()._webvue_finance_refs(run)
        if not run.webvue_move_id:
            return refs
        return {
            'entry_id': run.webvue_move_id.id,
            'entry_name': run.webvue_move_id.name if self._webvue_can('finance.entries.read') else None,
            'payment_id': run.webvue_payment_id.id or None,
            'payment_name': run.webvue_payment_id.name if run.webvue_payment_id and self._webvue_can_name_payment() else None,
        }
