# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

from odoo.addons.webvue_hr.rules import WebVueHrRule

DEPARTMENT_WRITE_ERROR = 'department management capability is required'
DEPARTMENT_SCOPE_ERROR = 'department is outside the current company'
DEPARTMENT_IN_USE_CODE = 'department_in_use'
ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'
ACCESS_USER_WRITE_MARKER = 'webvue_core.access_user_write'


class WebVueHrDepartment(models.Model):
    _inherit = 'hr.department'

    @api.model
    def _search(
        self,
        domain,
        offset=0,
        limit=None,
        order=None,
        *,
        active_test=True,
        bypass_access=False,
    ):
        if (
            not bypass_access
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            self.env['webvue.access.service']._webvue_require_capability(
                'hr.departments.read',
            )
            pinned = self.env['webvue.access.service']._webvue_pinned_company_ids()
            domain = Domain(domain) & Domain('company_id', 'in', pinned)
        return super()._search(
            domain,
            offset=offset,
            limit=limit,
            order=order,
            active_test=active_test,
            bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if (
            operation == 'read'
            and not self.env.is_superuser()
            and not self.env.user.has_group('base.group_system')
            and not self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            and not self.env.cr.precommit.data.get(ACCESS_USER_WRITE_MARKER)
        ):
            self.env['webvue.access.service']._webvue_require_capability(
                'hr.departments.read',
            )
            self._webvue_validate_scope()
        return super().check_access(operation)

    def _webvue_require_admin(self):
        if not self.env['webvue.access.service']._webvue_has_capability(
            self.env.user,
            'hr.departments.manage',
        ):
            raise AccessError(DEPARTMENT_WRITE_ERROR)

    def _webvue_validate_scope(self):
        if not self.ids:
            return
        self.env.cr.execute(
            SQL(
                'SELECT company_id FROM %s WHERE id = ANY(%s)',
                SQL.identifier(self._table),
                self.ids,
            ),
        )
        pinned = self.env['webvue.access.service']._webvue_pinned_company_ids()
        if any(company_id not in pinned for (company_id,) in self.env.cr.fetchall()):
            raise AccessError(DEPARTMENT_SCOPE_ERROR)

    @staticmethod
    def _webvue_relation_id(value):
        return value.id if hasattr(value, 'id') else value

    def _webvue_validate_relations(self, vals):
        for key, model in (
            ('parent_id', 'hr.department'),
            ('manager_id', 'hr.employee'),
        ):
            if key not in vals or not vals[key]:
                continue
            record = (
                self.env[model].browse(self._webvue_relation_id(vals[key])).exists()
            )
            pinned = self.env['webvue.access.service']._webvue_pinned_company_ids()
            if not record or any(item.company_id.id not in pinned for item in record):
                raise AccessError('%s is outside the current company' % key)

    def _webvue_create(self, vals):
        self._webvue_require_admin()
        self._webvue_validate_relations(vals)
        vals = dict(vals)
        vals.setdefault('company_id', self.env.company.id)
        if vals['company_id'] != self.env.company.id:
            raise AccessError(DEPARTMENT_SCOPE_ERROR)
        with self.env.cr.savepoint():
            return super().create(vals)

    def _webvue_write(self, vals):
        self._webvue_require_admin()
        self._webvue_validate_scope()
        self._webvue_validate_relations(vals)
        with self.env.cr.savepoint():
            return super().write(vals)

    def _webvue_usage(self):
        self.ensure_one()
        employees = (
            self.env['hr.employee']
            .with_context(active_test=False)
            .search_count(
                [
                    ('department_id', '=', self.id),
                ],
            )
        )
        children = (
            self.env['hr.department']
            .with_context(active_test=False)
            .search_count(
                [
                    ('parent_id', '=', self.id),
                ],
            )
        )
        return {'employees': employees, 'children': children}

    def _webvue_serialized_relations(self):
        self.ensure_one()
        return self._webvue_serialized_relations_map()[self.id]

    def _webvue_serialized_relations_map(self):
        if not self.ids:
            return {}
        self._webvue_validate_scope()
        pinned = self.env['webvue.access.service']._webvue_pinned_company_ids()
        self.env.cr.execute(
            SQL(
                """
                SELECT department.id, department.parent_id, manager.id, manager.name
                  FROM hr_department department
                  LEFT JOIN hr_employee manager ON manager.id = department.manager_id
                 WHERE department.id = ANY(%s) AND department.company_id IN %s
            """,
                self.ids,
                tuple(pinned),
            ),
        )
        rows = self.env.cr.fetchall()
        if len(rows) != len(set(self.ids)):
            raise AccessError(DEPARTMENT_SCOPE_ERROR)
        text = self.env['webvue.access.service']._webvue_hr_text
        parents = {}
        managers = {}
        for department_id, parent_id, manager_id, manager_name in rows:
            parents[department_id] = parent_id or None
            managers[department_id] = (
                {'id': manager_id, 'name': text(manager_name)} if manager_id else None
            )
        self.env.cr.execute(
            SQL(
                """
                SELECT parent_id, id
                  FROM hr_department
                 WHERE parent_id = ANY(%s) AND company_id IN %s
                 ORDER BY id
            """,
                self.ids,
                tuple(pinned),
            ),
        )
        child_ids = {department_id: [] for department_id in self.ids}
        for parent_id, child_id in self.env.cr.fetchall():
            child_ids[parent_id].append(child_id)
        include_archived = self.env['webvue.access.service']._webvue_has_capability(
            self.env.user,
            'hr.employees.archive',
        )
        self.env.cr.execute(
            SQL(
                """
                SELECT version.department_id, COUNT(*)
                  FROM hr_employee employee
                  JOIN hr_version version ON version.id = employee.current_version_id
                 WHERE employee.company_id IN %s
                   AND version.department_id = ANY(%s)
                   AND (%s OR employee.active IS TRUE)
                 GROUP BY version.department_id
            """,
                tuple(pinned),
                self.ids,
                include_archived,
            ),
        )
        counts = dict.fromkeys(self.ids, 0)
        for department_id, count in self.env.cr.fetchall():
            counts[department_id] = count
        return {
            department.id: {
                'parent_id': parents[department.id],
                'manager': managers[department.id],
                'child_ids': child_ids[department.id],
                'employee_count': counts[department.id],
            }
            for department in self
        }

    def _webvue_delete(self):
        self._webvue_require_admin()
        self._webvue_validate_scope()
        usages = [(department, department._webvue_usage()) for department in self]
        for department, details in usages:
            if any(details.values()):
                raise WebVueHrRule(
                    DEPARTMENT_IN_USE_CODE,
                    'department still has employees, children, or documents',
                    details=details,
                )
        with self.env.cr.savepoint():
            super().unlink()
        return True

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser() and not self.env.user.has_group(
            'base.group_system',
        ):
            self._webvue_require_admin()
            for vals in vals_list:
                if vals.get('company_id', self.env.company.id) != self.env.company.id:
                    raise AccessError(DEPARTMENT_SCOPE_ERROR)
                self._webvue_validate_relations(vals)
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser() and not self.env.user.has_group(
            'base.group_system',
        ):
            self._webvue_require_admin()
            self._webvue_validate_scope()
            if vals.get('company_id', self.env.company.id) != self.env.company.id:
                raise AccessError(DEPARTMENT_SCOPE_ERROR)
            self._webvue_validate_relations(vals)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser() and not self.env.user.has_group(
            'base.group_system',
        ):
            msg = 'use_protected_webvue_hr_operation:hr_department_unlink'
            raise AccessError(msg)
        return super().unlink()
