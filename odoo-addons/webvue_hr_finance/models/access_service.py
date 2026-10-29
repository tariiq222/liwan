# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# The payroll finance manager posts approved runs and records their payment (owner decision 2026-10-29).
# The role belongs to the bridge: only here do the HR and finance capabilities meet.
PAYROLL_FINANCE_PERMISSIONS = frozenset(
    {
        'hr.employees.read',
        'hr.payroll.read',
        'hr.payroll.finance.manage',
        'finance.invoices.read',
        'finance.entries.read',
        'finance.entries.manage',
        'finance.entries.post',
        'finance.payments.read',
        'finance.payments.manage',
    },
)


class WebVueAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        role_xmlid = 'webvue_hr_finance.role_payroll_finance_manager'
        grants[role_xmlid] = grants.get(role_xmlid, set()) | PAYROLL_FINANCE_PERMISSIONS
        return grants
