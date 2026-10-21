# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

# Stock gates the contract block behind hr.group_hr_manager, which also bypasses company
# isolation on hr.version; the manage capability reads and writes it through these groups.
CONTRACT_GROUPS = 'hr.group_hr_manager,webvue_hr.group_cap_hr_employees_manage'
# Stock gates the departure block behind hr.group_hr_user. The offboarding read capability
# joins it, so a departure is readable without the employee management capability;
# hr.employee takes the groups of these fields through its _inherits link.
OFFBOARDING_GROUPS = 'hr.group_hr_user,webvue_hr.group_cap_hr_offboarding_read'
# The pair that opens hr.version for reading only (writing stays behind
# hr.employees.manage): the offboarding area reads the departure fields of an employee.
OFFBOARDING_READ_CAPABILITIES = ('hr.employees.read', 'hr.offboarding.read')
# The payroll engine and the Saudi calculator read these stock version fields (service
# dates, nationality, national ID, departure); the payroll read capability joins their
# groups. wage is not opened: WebVue never reads or writes hr.version.wage.
PAYROLL_READ_GROUP = 'webvue_hr.group_cap_hr_payroll_read'
# The pair that opens hr.version for reading only, like the offboarding pair.
PAYROLL_READ_CAPABILITIES = ('hr.employees.read', 'hr.payroll.read')
PAYROLL_CONTRACT_GROUPS = f'{CONTRACT_GROUPS},{PAYROLL_READ_GROUP}'
PAYROLL_PERSONAL_GROUPS = f'hr.group_hr_user,{PAYROLL_READ_GROUP}'
# hr.payslip.line is ordered by its version, so every reader of payslip lines (an employee
# reads their own approved ones) resolves date_version in that ORDER BY join; the field
# is a bare version date and hr.version itself stays unreadable to the employee.
PAYROLL_VERSION_ORDER_GROUPS = f'{PAYROLL_PERSONAL_GROUPS},webvue_hr.group_cap_hr_employees_read'
PAYROLL_OFFBOARDING_GROUPS = f'{OFFBOARDING_GROUPS},{PAYROLL_READ_GROUP}'
VERSION_SCOPE_ERROR = 'employee version is outside the current company'
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
ACCESS_USER_WRITE_MARKER = 'webvue_core.access_user_write'


class WebVueHrVersion(models.Model):
    _inherit = 'hr.version'

    # Stock fields redeclared with the manage capability added to their groups.
    contract_date_start = fields.Date(groups=PAYROLL_CONTRACT_GROUPS)
    contract_date_end = fields.Date(groups=PAYROLL_CONTRACT_GROUPS)
    date_start = fields.Date(groups=PAYROLL_CONTRACT_GROUPS)
    date_end = fields.Date(groups=PAYROLL_CONTRACT_GROUPS)
    date_version = fields.Date(groups=PAYROLL_VERSION_ORDER_GROUPS)
    country_id = fields.Many2one(groups=PAYROLL_PERSONAL_GROUPS)
    identification_id = fields.Char(groups=PAYROLL_PERSONAL_GROUPS)
    trial_date_end = fields.Date(groups=CONTRACT_GROUPS)
    contract_type_id = fields.Many2one(groups=CONTRACT_GROUPS)
    identification_expiration_date = fields.Date(
        string='Identification Expiration Date',
        help='Expiry of the national ID or iqama held in identification_id.',
        groups=CONTRACT_GROUPS, tracking=True)
    notice_period_days = fields.Integer(
        string='Notice Period (days)',
        help='Days of notice either party must give to end the contract.',
        groups=CONTRACT_GROUPS, tracking=True)
    # The stock departure block, regrouped for the offboarding capability.
    departure_reason_id = fields.Many2one(groups=PAYROLL_OFFBOARDING_GROUPS)
    departure_description = fields.Html(groups=OFFBOARDING_GROUPS)
    departure_date = fields.Date(groups=PAYROLL_OFFBOARDING_GROUPS)

    _notice_period_days_non_negative = models.Constraint(
        'CHECK (notice_period_days >= 0)',
        'The notice period cannot be negative.',
    )

    def _webvue_trusted_internal_user_change(self):
        data = self.env.cr.precommit.data
        return bool(
            data.get(ACCESS_USER_CREATE_MARKER)
            or data.get(ACCESS_USER_WRITE_MARKER),
        )

    def _webvue_version_read_allowed(self):
        """Whether the caller may read employee versions.

        The employee management capability owns the whole record. The offboarding read
        pair opens it for reading only, because a departure is the departure fields of an
        employee the area is allowed to see; the payroll read pair opens it for the payslip
        engine. Every write stays behind hr.employees.manage.
        """
        service = self.env['webvue.access.service']
        if service._webvue_has_capability(self.env.user, 'hr.employees.manage'):
            return True
        return any(
            all(service._webvue_has_capability(self.env.user, key) for key in pair)
            for pair in (OFFBOARDING_READ_CAPABILITIES, PAYROLL_READ_CAPABILITIES)
        )

    def _webvue_require_version_read(self):
        if not self._webvue_version_read_allowed():
            self.env['webvue.access.service']._webvue_require_capability(
                'hr.employees.manage',
            )

    def _webvue_validate_scope(self):
        if not self.ids:
            return
        self.env.cr.execute(SQL(
            'SELECT company_id FROM %s WHERE id = ANY(%s)',
            SQL.identifier(self._table), self.ids,
        ))
        if any(company_id != self.env.company.id for company_id, in self.env.cr.fetchall()):
            raise AccessError(VERSION_SCOPE_ERROR)

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self._webvue_trusted_internal_user_change()
        ):
            self._webvue_require_version_read()
            domain = Domain(domain) & Domain('company_id', '=', self.env.company.id)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation in ('read', 'write', 'unlink')
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self._webvue_trusted_internal_user_change()
        ):
            if operation == 'read':
                self._webvue_require_version_read()
            else:
                self.env['webvue.access.service']._webvue_require_capability(
                    'hr.employees.manage',
                )
            self._webvue_validate_scope()
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self.env['webvue.access.service']._webvue_require_capability(
                'hr.employees.manage',
            )
            if any(
                vals.get('company_id', self.env.company.id) != self.env.company.id
                for vals in vals_list
            ):
                raise AccessError(VERSION_SCOPE_ERROR)
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self.env['webvue.access.service']._webvue_require_capability(
                'hr.employees.manage',
            )
            self._webvue_validate_scope()
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(VERSION_SCOPE_ERROR)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            msg = 'employee versions cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()
