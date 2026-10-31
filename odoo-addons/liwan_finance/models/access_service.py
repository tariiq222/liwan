# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

FINANCE_PERMISSIONS = frozenset({
    'finance.invoices.read', 'finance.payments.read',
    'finance.accounts.read', 'finance.accounts.manage', 'finance.journals.read', 'finance.journals.manage',
    'finance.partners.read', 'finance.partners.manage',
    'finance.invoices.manage', 'finance.invoices.post', 'finance.payments.manage',
    'finance.setup.read', 'finance.setup.manage', 'finance.reports.read',
    'finance.entries.read', 'finance.entries.manage', 'finance.entries.post',
    'finance.statements.read', 'finance.zakat.read', 'finance.bank.read', 'finance.bank.manage',
    'finance.assets.read', 'finance.assets.manage',
    'finance.zatca.read', 'finance.zatca.manage', 'finance.zatca.submit',
    'finance.analytic.read', 'finance.analytic.manage',
    'finance.budgets.read', 'finance.budgets.manage',
    'finance.closing.read', 'finance.closing.manage',
    'finance.audit.read',
    'finance.zakat.review',
    'finance.zakat.manage',
    'finance.taxes.read', 'finance.taxes.manage',
    'finance.payment_terms.read', 'finance.payment_terms.manage',
})
FINANCE_PERMISSION_DEPENDENCIES = {
    'finance.zakat.review': {'finance.zakat.read'},
    'finance.zakat.manage': {'finance.zakat.read'},
    'finance.accounts.manage': {'finance.accounts.read'},
    'finance.payment_terms.manage': {'finance.payment_terms.read'},
    'finance.taxes.manage': {'finance.taxes.read'},
    'finance.journals.manage': {'finance.journals.read'},
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
    'finance.closing.manage': {'finance.closing.read', 'finance.setup.manage'},
}

# The accountant registers and cancels payments (Odoo posts the payment move), enters bank statements and
# reconciles them (including write-offs); it never posts invoices or journal entries, closes years, changes
# setup or onboards ZATCA.
FINANCE_ACCOUNTANT_PERMISSIONS = frozenset({
    'finance.invoices.read', 'finance.invoices.manage',
    'finance.payments.read', 'finance.payments.manage',
    'finance.partners.read', 'finance.partners.manage',
    'finance.entries.read', 'finance.entries.manage',
    'finance.bank.read', 'finance.bank.manage',
    'finance.accounts.read', 'finance.journals.read',
    'finance.reports.read', 'finance.statements.read',
    'finance.zatca.read', 'finance.zatca.submit',
    'finance.budgets.read', 'finance.assets.read', 'finance.analytic.read', 'finance.taxes.read', 'finance.payment_terms.read',
})
# Read-only by construction: a new read capability is added here by an explicit decision.
FINANCE_AUDITOR_PERMISSIONS = frozenset({
    'finance.invoices.read', 'finance.payments.read', 'finance.partners.read',
    'finance.accounts.read', 'finance.journals.read', 'finance.entries.read',
    'finance.bank.read', 'finance.statements.read', 'finance.zakat.read',
    'finance.reports.read', 'finance.audit.read', 'finance.budgets.read',
    'finance.assets.read', 'finance.analytic.read', 'finance.closing.read',
    'finance.setup.read', 'finance.zatca.read', 'finance.taxes.read', 'finance.payment_terms.read',
})


class LiwanFinanceAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_branch_strict_definitions(self):
        return {**super()._liwan_branch_strict_definitions(), 'finance': ('finance.', ())}

    @api.model
    def _liwan_model_company_ids(self, model_name, operation):
        """A branch shares the chart of accounts of its ancestors: their accounts are inside the fence of its users.

        The core fence admits a record whose ``company_ids`` meets the companies the user holds a capability in, so
        the chart the branch shares (owned by its root company) was hidden from the branch's own finance staff, with
        native ``parent_of`` rules and domains all agreeing it should be visible. Only the accounts are widened:
        entries, journals and taxes belong to one company and keep the plain fence.
        """
        companies = super()._liwan_model_company_ids(model_name, operation)
        if model_name != 'account.account' or not companies:
            return companies
        ancestors = {int(part) for company in self.env['res.company'].browse(companies) for part in company.parent_path.split('/') if part}
        return sorted(ancestors | set(companies))

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_finance'} for key in sorted(FINANCE_PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key, required in FINANCE_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid in (
            'liwan_finance.role_finance_manager',
            'liwan_core.role_vendor_support',
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | FINANCE_PERMISSIONS
        for role_xmlid, keys in (
            ('liwan_finance.role_finance_accountant', FINANCE_ACCOUNTANT_PERMISSIONS),
            ('liwan_finance.role_finance_auditor', FINANCE_AUDITOR_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_finance.group_finance_manager'):
            keys |= FINANCE_PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'finance_manager']
