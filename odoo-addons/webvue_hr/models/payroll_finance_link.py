# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueHrPayrollFinanceLink(models.AbstractModel):
    """Where a payroll run meets accounting, when the finance bridge is installed.

    Extension point: the bridge addon overrides both hooks through ``super()``. Without it a run
    offers no posting or payment action and carries no accounting reference. Every hook runs in the
    caller's own environment and the route layer has already checked that the caller may read the run.
    """

    _name = 'webvue.hr.payroll.finance.link'
    _description = 'WebVue HR payroll finance link'
    _webvue_scope = 'global'

    @api.model
    def _webvue_finance_actions(self, run):
        """The extra actions (``post``, ``pay``...) the caller may take on ``run``."""
        return []

    @api.model
    def _webvue_finance_refs(self, run):
        """``{entry_id, entry_name, payment_id, payment_name}`` of the run's accounting records, or None."""
        return
