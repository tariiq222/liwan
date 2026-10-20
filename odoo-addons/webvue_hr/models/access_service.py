# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

HR_PERMISSIONS = frozenset(
    {
        'hr.employees.read',
        'hr.employees.manage',
        'hr.employees.archive',
        'hr.employees.access_status.read',
        'hr.departments.read',
        'hr.departments.manage',
        'hr.leave.read',
        'hr.leave.request',
        'hr.leave.approve',
        'hr.leave.manage',
    },
)
EMPLOYEE_HR_PERMISSIONS = frozenset(
    {
        'hr.employees.read',
        'hr.departments.read',
        'hr.leave.read',
        'hr.leave.request',
    },
)
HR_PERMISSION_DEPENDENCIES = {
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    # Every leave route reads hr.employee (the caller's own record, the target of an
    # allocation, and the name on each request), which the HR employee guard requires.
    'hr.leave.read': {'hr.employees.read'},
    'hr.leave.request': {'hr.leave.read'},
    'hr.leave.approve': {'hr.leave.read'},
    'hr.leave.manage': {'hr.leave.read'},
}


class WebVueHrAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_hr'} for key in sorted(HR_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in HR_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_hr.role_hr_manager', HR_PERMISSIONS),
            ('webvue_core.role_employee', EMPLOYEE_HR_PERMISSIONS),
            ('webvue_core.role_vendor_support', HR_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_hr.group_hr_manager') or user.has_group(
            'hr.group_hr_manager',
        ):
            keys |= HR_PERMISSIONS
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_HR_PERMISSIONS
        return keys

    @api.model
    def _webvue_customer_actor_keys(self):
        return super()._webvue_customer_actor_keys() | {'hr.employees.archive'}

    @api.model
    def _webvue_legacy_admin_roles(self):
        return [*super()._webvue_legacy_admin_roles(), 'hr_manager']

    def _webvue_hr_text(self, value):
        if not isinstance(value, dict):
            return value
        return (
            value.get(self.env.lang)
            or value.get('en_US')
            or next(iter(value.values()), '')
        )
