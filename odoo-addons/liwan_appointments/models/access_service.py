# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

BOOKINGS_WRITE = 'appointments.bookings.write'
BOOKINGS_MANAGE = 'appointments.bookings.manage'
PERMISSIONS = frozenset({'appointments.bookings.read', BOOKINGS_WRITE, BOOKINGS_MANAGE})
# The manager prices and links the product that sells a booking type through liwan.products.service (plan D4, option A).
# A built-in role grant does not complete dependencies, so the read capability the other two require is listed too.
MANAGER_PRODUCT_PERMISSIONS = frozenset({'products.read', 'products.manage', 'products.prices.manage'})
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
            ('liwan_appointments.role_appointments_manager', PERMISSIONS | MANAGER_PRODUCT_PERMISSIONS),
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
