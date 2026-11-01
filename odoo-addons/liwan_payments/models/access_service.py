# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PROVIDERS_MANAGE = 'payments.providers.manage'
LINKS_MANAGE = 'payments.links.manage'
# What a pay link needs besides LINKS_MANAGE: reading the invoice it names (a finance capability, named here only as the key
# the refusal tells), and the capability that marks a system administrator.
INVOICES_READ = 'finance.invoices.read'
SYSTEM_ADMIN = 'access.roles.manage'
SETTINGS_MANAGE = 'payments.settings.manage'
ORDERS_READ = 'payments.orders.read'
# Recording a refund moves the tenant's money: no other capability implies it and no built-in role
# holds it; a system admin gives it to a role (owner decision 2026-10-29).
REFUND = 'payments.refund'
ADMIN_PERMISSIONS = frozenset({PROVIDERS_MANAGE, LINKS_MANAGE, SETTINGS_MANAGE, ORDERS_READ})
PERMISSIONS = ADMIN_PERMISSIONS | {REFUND}
# A refund is recorded from the order it refunds.
PERMISSION_DEPENDENCIES = {REFUND: {ORDERS_READ}}


class LiwanPaymentsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_payments'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        role = 'liwan_core.role_system_admin'
        grants[role] = grants.get(role, set()) | ADMIN_PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_access_admin'):
            keys |= ADMIN_PERMISSIONS
        return keys
