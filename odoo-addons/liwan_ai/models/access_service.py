# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

AI_USE = 'ai.use'
AI_SETTINGS_MANAGE = 'ai.settings.manage'
EMPLOYEE_PERMISSIONS = frozenset({AI_USE})
# The tenant administrator chooses the provider, signs the AI acknowledgement and reads the monitoring view.
ADMIN_PERMISSIONS = frozenset({AI_SETTINGS_MANAGE})


class LiwanAiAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_ai'} for key in (AI_USE, AI_SETTINGS_MANAGE)
        )

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_core.role_employee', EMPLOYEE_PERMISSIONS),
            ('liwan_core.role_system_admin', ADMIN_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
