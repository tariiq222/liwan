# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.webvue_inbox.models.access_service import REPLY

CATALOG_MANAGE = 'inbox.catalog.manage'
ORDERS_MANAGE = 'inbox.orders.manage'
PERMISSIONS = frozenset({CATALOG_MANAGE, ORDERS_MANAGE})
PERMISSION_DEPENDENCIES = {ORDERS_MANAGE: {REPLY}}
ROLE_GRANTS = {
    'webvue_inbox.role_inbox_agent': frozenset({ORDERS_MANAGE}),
    'webvue_inbox.role_inbox_supervisor': frozenset({ORDERS_MANAGE}),
    'webvue_inbox.role_inbox_manager': PERMISSIONS,
    'webvue_core.role_vendor_support': PERMISSIONS,
}


class WebVueInboxPaymentsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_inbox_payments'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in ROLE_GRANTS.items():
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_inbox.group_inbox_manager'):
            keys |= PERMISSIONS
        return keys
