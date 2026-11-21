# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset({'integrations.read', 'integrations.manage'})
# The message and call logs hold customer numbers and message text: no built-in role and no legacy group carries
# these, an administrator grants them through a role (owner decision 2026-11-20). They depend on nothing and nothing
# implies them.
LOG_PERMISSIONS = frozenset({'integrations.log.read'})
PERMISSION_DEPENDENCIES = {
    'integrations.manage': {'integrations.read'},
}


class LiwanIntegrationsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_integrations_sa'} for key in sorted(PERMISSIONS | LOG_PERMISSIONS)
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
