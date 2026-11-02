# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .hr_applicant import HIRE_FRAME_ATTRIBUTE
from .leave_cancellation import OWNER_AUTHORIZATION_KEYS, OWNER_AUTHORIZATION_MARKER

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
# Disciplinary warnings and employee-private insurance data (member numbers, dependents' identity numbers) sit behind
# their own keys, like payroll: vendor support and the legacy stock HR group never hold them. Only the HR manager role
# and custom roles an administrator builds do.
PRIVATE_HR_PERMISSIONS = frozenset(
    {
        'hr.warnings.read',
        'hr.warnings.manage',
        'hr.insurance.read',
        'hr.insurance.manage',
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
        'hr.payroll.audit.read',
        'hr.payroll.finance.manage',
    },
)
# The officer who settles a leaver's end of service: reads the offboarding page and works the payroll
# settlement (owner decision 2026-10-29). No configuration, audit or accounting right comes with it.
PAYROLL_OFFBOARDING_PERMISSIONS = frozenset(
    {
        'hr.employees.read',
        'hr.offboarding.read',
        'hr.payroll.read',
        'hr.payroll.manage',
        'hr.payroll.approve',
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
    'hr.warnings.read': {'hr.employees.read'},
    'hr.warnings.manage': {'hr.warnings.read'},
    'hr.insurance.read': {'hr.employees.read'},
    'hr.insurance.manage': {'hr.insurance.read'},
}
PAYROLL_PERMISSION_DEPENDENCIES = {
    'hr.payroll.read': {'hr.employees.read'},
    'hr.payroll.manage': {'hr.payroll.read'},
    'hr.payroll.approve': {'hr.payroll.read'},
    'hr.payroll.config': {'hr.payroll.read'},
    'hr.payroll.audit.read': {'hr.payroll.read'},
    'hr.payroll.finance.manage': {'hr.payroll.read'},
}


class LiwanHrAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_native_hire_frame(self):
        frame = getattr(self.env.cr, HIRE_FRAME_ATTRIBUTE, None)
        return frame if frame and frame[0] == self.env.uid and self.env.company.id in frame[1:3] else None

    @api.model
    def _liwan_native_hire_company(self):
        frame = self._liwan_native_hire_frame()
        return self.env['res.company'].browse(frame[2]) if frame else None

    @api.model
    def _liwan_branch_company_allowed(self, user, company):
        frame = self._liwan_native_hire_frame()
        if frame:
            if company.id != frame[2]:
                return False
            if self.env.company.id != frame[1]:
                return self.with_company(frame[1])._liwan_branch_company_allowed(user, company)
        return super()._liwan_branch_company_allowed(user, company)

    @api.model
    def _liwan_capability_keys(self, user=None, company=None):
        frame = self._liwan_native_hire_frame()
        if frame and self.env.company.id != frame[1]:
            return self.with_company(frame[1])._liwan_capability_keys(user, company=company or self.env.company)
        return super()._liwan_capability_keys(user, company=company)

    @api.model
    def _liwan_scoped_company_ids(self):
        frame = self._liwan_native_hire_frame()
        if frame:
            current = self.env.context.get('liwan_capability_scope') or ()
            scopes = (*frame[4], *(gate for gate in current if gate not in frame[4]))
            if self.env.company.id != frame[1] or current != scopes:
                return self.with_company(frame[1]).with_context(
                    liwan_capability_scope=scopes,
                )._liwan_scoped_company_ids()
            return [company_id for company_id in super()._liwan_scoped_company_ids() if company_id == frame[2]]
        return super()._liwan_scoped_company_ids()

    @api.model
    def _liwan_model_company_ids(self, model_name, operation):
        companies = super()._liwan_model_company_ids(model_name, operation)
        if model_name not in {'hr.leave', 'hr.leave.allocation'} or operation != 'read' or self.env.su:
            return companies
        # A leave request of the caller's own employee record stays readable in the
        # company that owns it, like stock hr_holidays. The descendant projection never
        # adds base.group_user to a branch company, so the generic fence would hide an
        # inherited branch owner's own request; the rule still limits the row to the
        # caller's own employee or a staff capability in that company.
        own_companies = set(self.env.user.employee_ids.company_id.ids)
        return sorted(set(companies) | (own_companies & set(self._liwan_membership_company_ids())))

    @api.model
    def _liwan_inherited_capability_keys(self, user, company):
        keys = super()._liwan_inherited_capability_keys(user, company)
        capsules = self.env.cr.precommit.data.get(OWNER_AUTHORIZATION_MARKER, set())
        if len(capsules) != 1:
            return keys
        owner_id, company_id, leave_id, authorization = next(iter(capsules))
        if (self.env.uid != owner_id or user.id != owner_id or company.id != company_id
                or self.env.company.id != company_id or authorization.cr is not self.env.cr
                or authorization.uid != owner_id or authorization.company.id == company_id):
            return keys
        # Delegate to the same policy calculation at its original root. Never
        # accept a context root, global native group or unmarked cached grant.
        original = authorization['liwan.access.service']
        memberships = original._liwan_membership_company_ids()
        if (not authorization.user.active or authorization.company.id not in memberships
                or company_id not in memberships or not original._liwan_has_capability(
                    authorization.user, 'hr.leave.request', company=company,
                )):
            return keys
        leave = authorization['hr.leave'].browse(leave_id)
        leave.check_access('read')
        if leave.company_id.id != company_id or leave.employee_id.user_id.id != owner_id:
            return keys
        return keys | (original._liwan_inherited_capability_keys(authorization.user, company)
                       & OWNER_AUTHORIZATION_KEYS)

    @api.model
    def _liwan_branch_strict_definitions(self):
        # Payroll keys share the hr. prefix, so HR leaves them to the payroll scope.
        return {**super()._liwan_branch_strict_definitions(),
                'hr': ('hr.', ('hr.payroll.',)), 'payroll': ('hr.payroll.', ())}

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_hr'} for key in sorted(HR_PERMISSIONS | PRIVATE_HR_PERMISSIONS | PAYROLL_PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
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
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_hr.role_hr_manager', HR_PERMISSIONS | PRIVATE_HR_PERMISSIONS),
            ('liwan_core.role_employee', EMPLOYEE_HR_PERMISSIONS),
            ('liwan_core.role_vendor_support', HR_PERMISSIONS),
            ('liwan_hr.role_payroll_manager', PAYROLL_PERMISSIONS),
            ('liwan_hr.role_payroll_offboarding_officer', PAYROLL_OFFBOARDING_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_hr.group_hr_manager') or user.has_group(
            'hr.group_hr_manager',
        ):
            keys |= HR_PERMISSIONS - {'hr.leave.config'}
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_HR_PERMISSIONS
        return keys

    @api.model
    def _liwan_customer_actor_keys(self):
        return super()._liwan_customer_actor_keys() | {'hr.employees.archive'}

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'hr_manager']

    def _liwan_hr_text(self, value):
        if not isinstance(value, dict):
            return value
        return (
            value.get(self.env.lang)
            or value.get('en_US')
            or next(iter(value.values()), '')
        )
