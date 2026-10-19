# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

FINANCE_PERMISSIONS = frozenset({
    'finance.invoices.read', 'finance.payments.read',
    'finance.accounts.read', 'finance.journals.read',
    'finance.partners.read', 'finance.partners.manage',
    'finance.invoices.manage', 'finance.invoices.post', 'finance.payments.manage',
    'finance.setup.read', 'finance.setup.manage', 'finance.reports.read',
    'finance.entries.read', 'finance.entries.manage', 'finance.entries.post',
    'finance.statements.read', 'finance.zakat.read', 'finance.bank.read', 'finance.bank.manage',
    'finance.assets.read', 'finance.assets.manage',
    'finance.zatca.read', 'finance.zatca.manage', 'finance.zatca.submit',
    'finance.analytic.read', 'finance.analytic.manage',
    'finance.budgets.read', 'finance.budgets.manage',
})
FINANCE_PERMISSION_DEPENDENCIES = {
    'finance.partners.manage': {'finance.partners.read'},
    'finance.invoices.manage': {'finance.invoices.read'},
    'finance.invoices.post': {'finance.invoices.manage'},
    'finance.payments.manage': {'finance.payments.read', 'finance.invoices.read'},
    'finance.setup.manage': {'finance.setup.read'},
    'finance.entries.manage': {'finance.entries.read'},
    'finance.entries.post': {'finance.entries.manage'},
    'finance.bank.manage': {'finance.bank.read'},
    'finance.assets.manage': {'finance.assets.read'},
    'finance.zatca.read': {'finance.invoices.read'},
    'finance.zatca.manage': {'finance.zatca.read'},
    'finance.zatca.submit': {'finance.zatca.read'},
    'finance.analytic.manage': {'finance.analytic.read'},
    'finance.budgets.manage': {'finance.budgets.read'},
}


class WebVueFinanceAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_finance'} for key in sorted(FINANCE_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in FINANCE_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid in (
            'webvue_finance.role_finance_manager',
            'webvue_core.role_vendor_support',
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | FINANCE_PERMISSIONS
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_finance.group_finance_manager'):
            keys |= FINANCE_PERMISSIONS
        return keys

    @api.model
    def _webvue_legacy_admin_roles(self):
        return [*super()._webvue_legacy_admin_roles(), 'finance_manager']
