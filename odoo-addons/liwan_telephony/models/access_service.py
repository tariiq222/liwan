# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# The four capabilities of design section 6. Listening to recordings is not implied by any other capability.
PERMISSIONS = frozenset({
    'telephony.use',
    'telephony.calls.read_all',
    'telephony.recordings.listen',
    'telephony.manage',
})
EMPLOYEE_PERMISSIONS = frozenset({'telephony.use'})
PERMISSION_DEPENDENCIES = {
    'telephony.calls.read_all': {'telephony.use'},
    'telephony.recordings.listen': {'telephony.use'},
    'telephony.manage': {'telephony.use'},
}


class LiwanTelephonyAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_telephony'} for key in sorted(PERMISSIONS)
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
        for role_xmlid, keys in (
            ('liwan_telephony.role_telephony_manager', PERMISSIONS),
            ('liwan_core.role_employee', EMPLOYEE_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_telephony.group_telephony_manager'):
            keys |= PERMISSIONS
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'telephony_manager']
