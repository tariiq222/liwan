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
        'hr.leave.config',
        'hr.recruitment.read',
        'hr.recruitment.manage',
        'hr.shifts.read',
        'hr.shifts.manage',
        'hr.onboarding.read',
        'hr.onboarding.manage',
        'hr.offboarding.read',
        'hr.offboarding.manage',
        'hr.assets.read',
        'hr.assets.manage',
    },
)
# Payroll is a section of this addon behind its own keys: no HR capability, role or
# group implies them, and they imply no HR write (they build only on employee read).
PAYROLL_PERMISSIONS = frozenset(
    {
        'hr.payroll.read',
        'hr.payroll.manage',
        'hr.payroll.approve',
        'hr.payroll.config',
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
    # Recruitment, shifts, onboarding, offboarding and assets. Every area route
    # names employees, which the HR employee guard requires; recruitment is the
    # exception, it works on applicants and job positions. Shifts, onboarding and
    # offboarding also need hr.employees.manage: the OCA planning engine writes
    # hr.version.resource_calendar_id, launching a stock activity plan posts a
    # message (a follower write) on hr.employee, and the stock departure wizard
    # writes the departure fields and contract_date_end (its ACL is
    # hr.group_hr_user, which hr.employees.manage already grants).
    'hr.recruitment.read': set(),
    'hr.recruitment.manage': {'hr.recruitment.read'},
    'hr.shifts.read': {'hr.employees.read'},
    'hr.shifts.manage': {'hr.shifts.read', 'hr.employees.manage'},
    'hr.onboarding.read': {'hr.employees.read'},
    'hr.onboarding.manage': {'hr.onboarding.read', 'hr.employees.manage'},
    'hr.offboarding.read': {'hr.employees.read'},
    'hr.offboarding.manage': {'hr.offboarding.read', 'hr.employees.manage'},
    'hr.assets.read': {'hr.employees.read'},
    'hr.assets.manage': {'hr.assets.read'},
}
PAYROLL_PERMISSION_DEPENDENCIES = {
    'hr.payroll.read': {'hr.employees.read'},
    'hr.payroll.manage': {'hr.payroll.read'},
    'hr.payroll.approve': {'hr.payroll.read'},
    'hr.payroll.config': {'hr.payroll.read'},
}


class WebVueHrAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_hr'} for key in sorted(HR_PERMISSIONS | PAYROLL_PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in (
            HR_PERMISSION_DEPENDENCIES | PAYROLL_PERMISSION_DEPENDENCIES
        ).items():
            # An HR capability without a dependency (hr.recruitment.read) is listed in the
            # constant for completeness, but the composed map only names keys that require
            # something: the stored permissions filter on dependency_ids, so a key with an
            # empty set would make the composed and stored maps disagree.
            if not required:
                continue
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role_xmlid, keys in (
            ('webvue_hr.role_hr_manager', HR_PERMISSIONS),
            ('webvue_core.role_employee', EMPLOYEE_HR_PERMISSIONS),
            ('webvue_core.role_vendor_support', HR_PERMISSIONS),
            ('webvue_hr.role_payroll_manager', PAYROLL_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_hr.group_hr_manager') or user.has_group(
            'hr.group_hr_manager',
        ):
            keys |= HR_PERMISSIONS - {'hr.leave.config'}
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
