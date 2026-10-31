# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The chat application's capability, grants and legacy keys (spec R2), composed through super()."""
from odoo import api, models

CHAT_SETTINGS_MANAGE = 'chat.settings.manage'
PERMISSIONS = frozenset({CHAT_SETTINGS_MANAGE})


class LiwanChatAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_chat'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid in ('liwan_core.role_system_admin', 'liwan_core.role_vendor_support'):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_access_admin') or user.has_group('liwan_core.group_customer_admin'):
            keys |= PERMISSIONS
        return keys
