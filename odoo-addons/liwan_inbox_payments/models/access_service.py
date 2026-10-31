# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_inbox.models.access_service import REPLY

CATALOG_MANAGE = 'inbox.catalog.manage'
ORDERS_MANAGE = 'inbox.orders.manage'
PERMISSIONS = frozenset({CATALOG_MANAGE, ORDERS_MANAGE})
PERMISSION_DEPENDENCIES = {ORDERS_MANAGE: {REPLY}}
ROLE_GRANTS = {
    'liwan_inbox.role_inbox_agent': frozenset({ORDERS_MANAGE}),
    'liwan_inbox.role_inbox_supervisor': frozenset({ORDERS_MANAGE}),
    'liwan_inbox.role_inbox_manager': PERMISSIONS,
}


class LiwanInboxPaymentsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._liwan_capability_keys(user, company=company)
        # Vendor support runs the channels and settings of the inbox and reads no customer content (INB-18): the
        # foundation shortcut that grants the whole catalog must not reach the customers' orders and catalog.
        return keys - PERMISSIONS if user.has_group('liwan_core.group_vendor_support') else keys

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_inbox_payments'} for key in sorted(PERMISSIONS)
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
        for role_xmlid, keys in ROLE_GRANTS.items():
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_inbox.group_inbox_manager'):
            keys |= PERMISSIONS
        return keys
