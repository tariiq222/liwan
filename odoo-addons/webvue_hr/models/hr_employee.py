# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

from odoo.addons.webvue_hr.models.hr_version import (
    CONTRACT_GROUPS,
    OFFBOARDING_GROUPS,
    PAYROLL_CONTRACT_GROUPS,
    PAYROLL_OFFBOARDING_GROUPS,
)
from odoo.addons.webvue_hr.rules import WebVueHrRule

EMPLOYEE_WRITE_ERROR = 'employee management capability is required'
EMPLOYEE_SCOPE_ERROR = 'employee is outside the current company'
INVALID_FIELD_CODE = 'invalid_field'
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
ACCESS_USER_WRITE_MARKER = 'webvue_core.access_user_write'


class WebVueHrEmployee(models.Model):
    _inherit = 'hr.employee'

    # Version fields behind a group are redeclared on the employee, like stock hr does.
    contract_date_start = fields.Date(
        related='version_id.contract_date_start', readonly=False,
        inherited=True, groups=PAYROLL_CONTRACT_GROUPS)
    contract_date_end = fields.Date(
        related='version_id.contract_date_end', readonly=False,
        inherited=True, groups=PAYROLL_CONTRACT_GROUPS)
    date_start = fields.Date(
        related='version_id.date_start', inherited=True, groups=PAYROLL_CONTRACT_GROUPS)
    date_end = fields.Date(
        related='version_id.date_end', inherited=True, groups=PAYROLL_CONTRACT_GROUPS)
    trial_date_end = fields.Date(
        related='version_id.trial_date_end', readonly=False,
        inherited=True, groups=CONTRACT_GROUPS)
    contract_type_id = fields.Many2one(
        related='version_id.contract_type_id', readonly=False,
        inherited=True, groups=CONTRACT_GROUPS)
    identification_expiration_date = fields.Date(
        related='version_id.identification_expiration_date', readonly=False,
        inherited=True, groups=CONTRACT_GROUPS)
    notice_period_days = fields.Integer(
        related='version_id.notice_period_days', readonly=False,
        inherited=True, groups=CONTRACT_GROUPS)
    # The departure block: readable and writable with the offboarding read capability too;
    # the payroll read capability reads the reason and the date for the end of service.
    departure_reason_id = fields.Many2one(
        related='version_id.departure_reason_id', readonly=False,
        inherited=True, groups=PAYROLL_OFFBOARDING_GROUPS)
    departure_description = fields.Html(
        related='version_id.departure_description', readonly=False,
        inherited=True, groups=OFFBOARDING_GROUPS)
    departure_date = fields.Date(
        related='version_id.departure_date', readonly=False,
        inherited=True, groups=PAYROLL_OFFBOARDING_GROUPS)

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            service = self.env['webvue.access.service']
            if not service._webvue_has_operation_capability(self.env.user, 'hr.employees.read'):
                raise AccessError(EMPLOYEE_WRITE_ERROR)
            pinned = service._webvue_operation_capability_company_ids('hr.employees.read')
            domain = Domain(domain) & Domain('company_id', 'in', pinned)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            service = self.env['webvue.access.service']
            if not service._webvue_has_operation_capability(self.env.user, 'hr.employees.read'):
                raise AccessError(EMPLOYEE_WRITE_ERROR)
            self._webvue_validate_scope(read_capability='hr.employees.read')
        return super().check_access(operation)

    def _webvue_has_capability(self, capability):
        return self.env['webvue.access.service']._webvue_has_capability(self.env.user, capability)

    def _webvue_require_capability(self, capability):
        if not self._webvue_has_capability(capability):
            raise AccessError(EMPLOYEE_WRITE_ERROR)

    def _webvue_validate_scope(self, read_capability=None):
        if not self.ids:
            return
        service = self.env['webvue.access.service']
        pinned = (service._webvue_operation_capability_company_ids(read_capability) if read_capability
                  else service._webvue_pinned_company_ids())
        self.env.cr.execute(SQL(
            'SELECT company_id FROM %s WHERE id = ANY(%s)',
            SQL.identifier(self._table), self.ids,
        ))
        if any(company_id not in pinned for company_id, in self.env.cr.fetchall()):
            raise AccessError(EMPLOYEE_SCOPE_ERROR)

    def _webvue_validate_mutation(self):
        self._webvue_require_capability('hr.employees.manage')
        self._webvue_validate_scope()

    def _webvue_relation_refs(self):
        self.ensure_one()
        self._webvue_validate_scope()
        self.env.cr.execute(
            '''
                SELECT department.id, department.name, manager.id, manager.name
                  FROM hr_employee employee
                  LEFT JOIN hr_version version ON version.id = employee.current_version_id
                  LEFT JOIN hr_department department ON department.id = version.department_id
                  LEFT JOIN hr_employee manager ON manager.id = employee.parent_id
                 WHERE employee.id = %s AND employee.company_id IN %s
            ''',
            [self.id, tuple(self.env['webvue.access.service']._webvue_pinned_company_ids())],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise AccessError(EMPLOYEE_SCOPE_ERROR)
        text = self.env['webvue.access.service']._webvue_hr_text
        return {
            'department': {'id': row[0], 'name': text(row[1])} if row[0] else None,
            'manager': {'id': row[2], 'name': text(row[3])} if row[2] else None,
        }

    def write(self, vals):
        # Keep the archive capability separate while preventing a caller with
        # only that capability from using the generic ORM write path.
        if not self.env.is_superuser():
            self._webvue_require_capability('hr.employees.manage')
            self._webvue_validate_scope()
            if 'user_id' in vals or 'active' in vals:
                raise WebVueHrRule(
                    INVALID_FIELD_CODE,
                    'user access is managed by the access actions',
                    field='user_id',
                )
        return super().write(vals)

    @api.model_create_multi
    def create(self, vals_list):
        if self.env.is_superuser():
            return super().create(vals_list)
        self._webvue_require_capability('hr.employees.manage')
        for vals in vals_list:
            if 'user_id' in vals or 'active' in vals:
                raise WebVueHrRule(
                    INVALID_FIELD_CODE,
                    'user access is managed by the access actions',
                    field='user_id',
                )
            company_id = vals.get('company_id')
            if company_id and company_id != self.env.company.id:
                raise AccessError(EMPLOYEE_SCOPE_ERROR)
        return super().create(vals_list)

    def _webvue_create(self, vals):
        self._webvue_require_capability('hr.employees.manage')
        company_id = vals.get('company_id') or self.env.company.id
        company = self.env['res.company'].browse(company_id)
        if not company.exists() or company != self.env.company:
            raise AccessError(EMPLOYEE_SCOPE_ERROR)
        vals = dict(vals)
        vals['company_id'] = company.id
        vals.pop('user_id', None)
        with self.env.cr.savepoint():
            return super().create(vals)

    def _webvue_write(self, vals):
        self._webvue_validate_mutation()
        vals = dict(vals)
        if 'user_id' in vals or 'active' in vals:
            raise WebVueHrRule(INVALID_FIELD_CODE, 'user access is managed by the access actions', field='user_id')
        with self.env.cr.savepoint():
            return super().write(vals)

    def _webvue_before_archive(self):
        """Extension point run inside the archive savepoint, before the rows are deactivated."""

    def _webvue_archive(self):
        self._webvue_require_capability('hr.employees.archive')
        self._webvue_validate_scope()
        with self.env.cr.savepoint():
            self._webvue_before_archive()
            # The resource model is deliberately protected against generic
            # active writes. Update the two stored columns here as the
            # capability-scoped archive operation after the before-archive
            # extension point has run.
            resource_ids = self.mapped('resource_id').ids
            self.env.cr.execute(
                'UPDATE resource_resource SET active = FALSE WHERE id = ANY(%s)',
                [resource_ids],
            )
            self.env.cr.execute(
                'UPDATE hr_employee SET active = FALSE WHERE id = ANY(%s)',
                [self.ids],
            )
            resources = self.mapped('resource_id')
            resources.invalidate_recordset(['active'])
            resources.modified(['active'])
            self.invalidate_recordset(['active'])
            self.modified(['active'])
        return True

    def _webvue_unarchive(self):
        self._webvue_require_capability('hr.employees.archive')
        self._webvue_validate_scope()
        with self.env.cr.savepoint():
            resource_ids = self.mapped('resource_id').ids
            self.env.cr.execute(
                'UPDATE resource_resource SET active = TRUE WHERE id = ANY(%s)',
                [resource_ids],
            )
            self.env.cr.execute(
                'UPDATE hr_employee SET active = TRUE WHERE id = ANY(%s)',
                [self.ids],
            )
            resources = self.mapped('resource_id')
            resources.invalidate_recordset(['active'])
            resources.modified(['active'])
            self.invalidate_recordset(['active'])
            self.modified(['active'])
        return True


class WebVueHrResource(models.Model):
    _inherit = 'resource.resource'

    def write(self, vals):
        if not self.env.is_superuser():
            # Stock HR lifecycle code may write the current value while
            # creating or synchronising a resource. Reject only an actual
            # sensitive transition so those normal writes remain valid while
            # generic resource ORM callers cannot link, unlink, archive, or
            # restore an employee behind the protected HR actions.
            for resource in self:
                if 'user_id' in vals and vals['user_id'] != resource.user_id.id:
                    msg = 'employee user access is managed by the access actions'
                    raise AccessError(msg)
                if 'active' in vals and bool(vals['active']) != bool(resource.active):
                    msg = 'employee activity is managed by the HR actions'
                    raise AccessError(msg)
        return super().write(vals)


class WebVueHrEmployeePublic(models.Model):
    _inherit = 'hr.employee.public'

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            service = self.env['webvue.access.service']
            if not service._webvue_has_operation_capability(self.env.user, 'hr.employees.read'):
                raise AccessError(EMPLOYEE_WRITE_ERROR)
            pinned = service._webvue_operation_capability_company_ids('hr.employees.read')
            domain = Domain(domain) & Domain('company_id', 'in', pinned)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            service = self.env['webvue.access.service']
            if not service._webvue_has_operation_capability(self.env.user, 'hr.employees.read'):
                raise AccessError(EMPLOYEE_WRITE_ERROR)
            pinned = service._webvue_operation_capability_company_ids('hr.employees.read')
            if self.ids:
                self.env.cr.execute(SQL(
                    'SELECT company_id FROM %s WHERE id = ANY(%s)',
                    SQL.identifier(self._table), self.ids,
                ))
            if self.ids and any(company_id not in pinned for company_id, in self.env.cr.fetchall()):
                raise AccessError(EMPLOYEE_SCOPE_ERROR)
        return super().check_access(operation)

    def _webvue_relation_refs(self):
        self.ensure_one()
        self.check_access('read')
        self.env.cr.execute(
            '''
                SELECT department.id, department.name, manager.id, manager.name
                  FROM hr_employee_public employee
                  LEFT JOIN hr_department department ON department.id = employee.department_id
                  LEFT JOIN hr_employee_public manager ON manager.id = employee.parent_id
                 WHERE employee.id = %s AND employee.company_id IN %s
            ''',
            [self.id, tuple(self.env['webvue.access.service']._webvue_pinned_company_ids())],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise AccessError(EMPLOYEE_SCOPE_ERROR)
        text = self.env['webvue.access.service']._webvue_hr_text
        return {
            'department': {'id': row[0], 'name': text(row[1])} if row[0] else None,
            'manager': {'id': row[2], 'name': text(row[3])} if row[2] else None,
        }
