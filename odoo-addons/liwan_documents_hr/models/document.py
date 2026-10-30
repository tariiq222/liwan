# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class Document(models.Model):
    _inherit = 'liwan.document'
    department_id = fields.Many2one(
        'hr.department', index=True, ondelete='restrict', check_company=True,
    )
    employee_id = fields.Many2one(
        'hr.employee', index=True, ondelete='restrict', check_company=True,
    )

    @api.model
    def _liwan_context_fields(self):
        return (*super()._liwan_context_fields(), 'department_id', 'employee_id')

    def _liwan_check_employee(self, value):
        if self.env.user._is_superuser():
            return
        self.env['liwan.document.links']._liwan_require_employee_context(write=True)
        if not value:
            return
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise AccessError(self.env._('Invalid employee context.'))
        employee = self.env['hr.employee'].search([
            ('id', '=', value), ('company_id', '=', self.env.company.id),
        ], limit=1)
        if not employee:
            raise AccessError(self.env._('Employee context is not available.'))

    @api.constrains('employee_id', 'department_id', 'visibility')
    def _liwan_employee_document_policy(self):
        for document in self:
            if document.employee_id and (
                document.visibility != 'restricted' or document.department_id
            ):
                raise ValidationError(self.env._('Employee documents must have one restricted employee context.'))

    def _liwan_check_department(self, value):
        if self.env.user._is_superuser():
            return
        self.env['liwan.document.links']._liwan_require_department_context(write=True)
        if not value:
            return
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            msg = 'invalid department context'
            raise AccessError(msg)
        department = self.env['hr.department'].search(
            [('id', '=', value), ('company_id', '=', self.env.company.id)],
        )
        if not department:
            msg = 'department context is not available'
            raise AccessError(msg)

    @api.model_create_multi
    def create(self, values):
        for item in values:
            if item.get('department_id'):
                self._liwan_check_department(item['department_id'])
            if item.get('employee_id'):
                self._liwan_check_employee(item['employee_id'])
        return super().create(values)

    def write(self, values):
        if 'employee_id' in values and (values['employee_id'] or self.employee_id):
            self._liwan_check_employee(values['employee_id'])
            if values['employee_id'] and any(document.visibility != 'restricted' for document in self):
                raise AccessError(self.env._('Restrict document access before assigning an employee.'))
        if values.get('visibility') == 'company' and (values.get('employee_id') or self.employee_id):
            raise AccessError(self.env._('Employee documents must remain restricted.'))
        if 'department_id' in values and (values['department_id'] or self.department_id):
            self._liwan_check_department(values['department_id'])
        return super().write(values)
