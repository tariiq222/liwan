# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset({'integrations.read', 'integrations.manage'})
PERMISSION_DEPENDENCIES = {
    'integrations.manage': {'integrations.read'},
}


class WebVueIntegrationsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_integrations_sa'} for key in sorted(PERMISSIONS)
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
        role = 'webvue_core.role_system_admin'
        grants[role] = grants.get(role, set()) | PERMISSIONS
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_core.group_access_admin'):
            keys |= PERMISSIONS
        return keys
