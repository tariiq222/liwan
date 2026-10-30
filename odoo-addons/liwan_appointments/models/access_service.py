# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset({'appointments.bookings.read', 'appointments.bookings.write', 'appointments.bookings.manage'})
EMPLOYEE_PERMISSIONS = frozenset({'appointments.bookings.read'})
PERMISSION_DEPENDENCIES = {
    'appointments.bookings.manage': {'appointments.bookings.write'},
    'appointments.bookings.write': {'appointments.bookings.read'},
}


class LiwanAppointmentsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_appointments'} for key in sorted(PERMISSIONS)
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
            ('liwan_appointments.role_appointments_manager', PERMISSIONS),
            ('liwan_core.role_employee', EMPLOYEE_PERMISSIONS),
            ('liwan_core.role_vendor_support', PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_appointments.group_appointments_manager'):
            keys |= PERMISSIONS
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'appointments_manager']
