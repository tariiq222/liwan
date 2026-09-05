# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

from odoo.addons.nasq_hr.rules import NasqHrRule

DEPARTMENT_WRITE_ERROR = 'department management capability is required'
DEPARTMENT_SCOPE_ERROR = 'department is outside the current company'
DEPARTMENT_IN_USE_CODE = 'department_in_use'
ACCESS_USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'
ACCESS_USER_WRITE_MARKER = 'nasq_core.access_user_write'


class NasqHrDepartment(models.Model):
    _inherit = 'hr.department'

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
            self.env['nasq.access.service']._nasq_require_capability('hr.departments.read')
            domain = Domain(domain) & Domain('company_id', '=', self.env.company.id)
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
            self.env['nasq.access.service']._nasq_require_capability('hr.departments.read')
            self._nasq_validate_scope()
        return super().check_access(operation)

    def _nasq_require_admin(self):
        if not self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'hr.departments.manage',
        ):
            raise AccessError(DEPARTMENT_WRITE_ERROR)

    def _nasq_validate_scope(self):
        if not self.ids:
            return
        self.env.cr.execute(SQL(
            'SELECT company_id FROM %s WHERE id = ANY(%s)',
            SQL.identifier(self._table), self.ids,
        ))
        if any(company_id != self.env.company.id for company_id, in self.env.cr.fetchall()):
            raise AccessError(DEPARTMENT_SCOPE_ERROR)

    @staticmethod
    def _nasq_relation_id(value):
        return value.id if hasattr(value, 'id') else value

    def _nasq_validate_relations(self, vals):
        for key, model in (('parent_id', 'hr.department'), ('manager_id', 'hr.employee')):
            if key not in vals or not vals[key]:
                continue
            record = self.env[model].browse(self._nasq_relation_id(vals[key])).exists()
            if not record or any(item.company_id != self.env.company for item in record):
                raise AccessError('%s is outside the current company' % key)

    def _nasq_create(self, vals):
        self._nasq_require_admin()
        self._nasq_validate_relations(vals)
        vals = dict(vals)
        vals.setdefault('company_id', self.env.company.id)
        if vals['company_id'] != self.env.company.id:
            raise AccessError(DEPARTMENT_SCOPE_ERROR)
        with self.env.cr.savepoint():
            return super().create(vals)

    def _nasq_write(self, vals):
        self._nasq_require_admin()
        self._nasq_validate_scope()
        self._nasq_validate_relations(vals)
        with self.env.cr.savepoint():
            return super().write(vals)

    def _nasq_usage(self):
        self.ensure_one()
        employees = self.env['hr.employee'].with_context(active_test=False).search_count([
            ('department_id', '=', self.id),
        ])
        children = self.env['hr.department'].with_context(active_test=False).search_count([
            ('parent_id', '=', self.id),
        ])
        documents = self.env['nasq.hr.document'].with_context(active_test=False).search_count([
            ('department_id', '=', self.id),
        ])
        return {'employees': employees, 'children': children, 'documents': documents}

    def _nasq_serialized_relations(self):
        self.ensure_one()
        self._nasq_validate_scope()
        self.env.cr.execute(
            '''
                SELECT department.parent_id, manager.id, manager.name
                  FROM hr_department department
                  LEFT JOIN hr_employee manager ON manager.id = department.manager_id
                 WHERE department.id = %s AND department.company_id = %s
            ''',
            [self.id, self.env.company.id],
        )
        row = self.env.cr.fetchone()
        if not row:
            raise AccessError(DEPARTMENT_SCOPE_ERROR)
        self.env.cr.execute(
            'SELECT id FROM hr_department WHERE parent_id = %s AND company_id = %s ORDER BY id',
            [self.id, self.env.company.id],
        )
        child_ids = [child_id for child_id, in self.env.cr.fetchall()]
        include_archived = self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'hr.employees.archive',
        )
        self.env.cr.execute(
            '''
                SELECT COUNT(*)
                  FROM hr_employee employee
                  JOIN hr_version version ON version.id = employee.current_version_id
                 WHERE employee.company_id = %s AND version.department_id = %s
                   AND (%s OR employee.active IS TRUE)
            ''',
            [self.env.company.id, self.id, include_archived],
        )
        text = self.env['nasq.access.service']._nasq_hr_text
        return {
            'parent_id': row[0] or None,
            'manager': {'id': row[1], 'name': text(row[2])} if row[1] else None,
            'child_ids': child_ids,
            'employee_count': self.env.cr.fetchone()[0],
        }

    def _nasq_delete(self):
        self._nasq_require_admin()
        self._nasq_validate_scope()
        usages = [(department, department._nasq_usage()) for department in self]
        for department, details in usages:
            if any(details.values()):
                raise NasqHrRule(
                    DEPARTMENT_IN_USE_CODE, 'department still has employees, children, or documents',
                    details=details,
                )
        with self.env.cr.savepoint():
            super().unlink()
        return True

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self._nasq_require_admin()
            for vals in vals_list:
                if vals.get('company_id', self.env.company.id) != self.env.company.id:
                    raise AccessError(DEPARTMENT_SCOPE_ERROR)
                self._nasq_validate_relations(vals)
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            self._nasq_require_admin()
            self._nasq_validate_scope()
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(DEPARTMENT_SCOPE_ERROR)
            self._nasq_validate_relations(vals)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser() and not self.env.user.has_group('base.group_system'):
            msg = 'use_protected_nasq_hr_operation:hr_department_unlink'
            raise AccessError(msg)
        return super().unlink()
