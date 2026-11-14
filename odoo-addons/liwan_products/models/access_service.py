# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PRODUCTS_READ = 'products.read'
PRODUCTS_MANAGE = 'products.manage'
PRODUCTS_PRICES_MANAGE = 'products.prices.manage'
PRODUCTS_SETTINGS_MANAGE = 'products.settings.manage'
PERMISSIONS = frozenset({PRODUCTS_READ, PRODUCTS_MANAGE, PRODUCTS_PRICES_MANAGE, PRODUCTS_SETTINGS_MANAGE})
PERMISSION_DEPENDENCIES = {
    PRODUCTS_MANAGE: {PRODUCTS_READ},
    PRODUCTS_PRICES_MANAGE: {PRODUCTS_READ},
}


class LiwanProductsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_products'} for key in sorted(PERMISSIONS)
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
