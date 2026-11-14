# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

CUSTOMERS_READ = 'customers.read'
CUSTOMERS_MANAGE = 'customers.manage'
CUSTOMERS_EXPORT = 'customers.export'
CUSTOMERS_SETTINGS_MANAGE = 'customers.settings.manage'
# The privacy capabilities (PDPL requests about one person): held by the built-in system administrator role only. They
# are not custom_role_allowed, no other customers capability implies them, and the vendor support shortcut of the
# foundation does not reach them.
CUSTOMERS_ERASE = 'customers.erase'
CUSTOMERS_PRIVACY_EXPORT = 'customers.privacy.export'
PRIVACY_PERMISSIONS = frozenset({CUSTOMERS_ERASE, CUSTOMERS_PRIVACY_EXPORT})
PERMISSIONS = frozenset({
    CUSTOMERS_READ, CUSTOMERS_MANAGE, CUSTOMERS_EXPORT, CUSTOMERS_SETTINGS_MANAGE, *PRIVACY_PERMISSIONS,
})
PERMISSION_DEPENDENCIES = {
    CUSTOMERS_MANAGE: {CUSTOMERS_READ},
    CUSTOMERS_EXPORT: {CUSTOMERS_READ},
    CUSTOMERS_ERASE: {CUSTOMERS_READ},
    CUSTOMERS_PRIVACY_EXPORT: {CUSTOMERS_READ},
}


class LiwanCustomersAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Support's foundation shortcut grants every registered key; a vendor never erases or exports a tenant's person.
        return keys - PRIVACY_PERMISSIONS if user.has_group('liwan_core.group_vendor_support') else keys

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
