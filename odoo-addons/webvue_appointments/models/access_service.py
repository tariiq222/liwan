# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset({'appointments.view', 'appointments.book', 'appointments.manage'})
EMPLOYEE_PERMISSIONS = frozenset({'appointments.view'})
PERMISSION_DEPENDENCIES = {
    'appointments.manage': {'appointments.book'},
    'appointments.book': {'appointments.view'},
}


class WebVueAppointmentsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_appointments'} for key in sorted(PERMISSIONS)
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
        for role_xmlid, keys in (
            ('webvue_appointments.role_appointments_manager', PERMISSIONS),
            ('webvue_core.role_employee', EMPLOYEE_PERMISSIONS),
            ('webvue_core.role_vendor_support', PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_appointments.group_appointments_manager'):
            keys |= PERMISSIONS
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys

    @api.model
    def _webvue_legacy_admin_roles(self):
        return [*super()._webvue_legacy_admin_roles(), 'appointments_manager']
