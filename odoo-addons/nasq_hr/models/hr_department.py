# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError

from ..rules import NasqHrRule


class NasqHrDepartment(models.Model):
    _inherit = 'hr.department'

    def _nasq_require_admin(self):
        if not self.env.user.has_group('nasq_core.group_customer_admin'):
            raise AccessError('only a customer administrator can write departments')

    def _nasq_validate_scope(self):
        if any(department.company_id not in self.env.companies for department in self):
            raise AccessError('department is outside the current company')

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

    def _nasq_delete(self):
        self._nasq_require_admin()
        self._nasq_validate_scope()
        usages = [(department, department._nasq_usage()) for department in self]
        for department, details in usages:
            if any(details.values()):
                raise NasqHrRule(
                    'department_in_use', 'department still has employees, children, or documents',
                    details=details,
                )
        with self.env.cr.savepoint():
            super().unlink()
        return True
