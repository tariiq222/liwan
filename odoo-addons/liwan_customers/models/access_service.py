# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

CUSTOMERS_READ = 'customers.read'
CUSTOMERS_MANAGE = 'customers.manage'
CUSTOMERS_EXPORT = 'customers.export'
CUSTOMERS_SETTINGS_MANAGE = 'customers.settings.manage'
PERMISSIONS = frozenset({CUSTOMERS_READ, CUSTOMERS_MANAGE, CUSTOMERS_EXPORT, CUSTOMERS_SETTINGS_MANAGE})
PERMISSION_DEPENDENCIES = {
    CUSTOMERS_MANAGE: {CUSTOMERS_READ},
    CUSTOMERS_EXPORT: {CUSTOMERS_READ},
}


class LiwanCustomersAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_customers'} for key in sorted(PERMISSIONS)
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
        grants[role] = grants.get(role, set()) | PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_access_admin'):
            keys |= PERMISSIONS
        return keys
