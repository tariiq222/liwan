# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule


class DocumentLinks(models.AbstractModel):
    _inherit = 'webvue.document.links'

    @api.model
    def _webvue_employee_context_available(self):
        return self.env['webvue.entitlement.service']._webvue_feature_read('hr.enabled') and self.env[
            'webvue.access.service'
        ]._webvue_has_capability(self.env.user, 'hr.employees.manage')

    @api.model
    def _webvue_require_employee_context(self, *, write=False):
        self.env['webvue.access.service']._webvue_require_capability('hr.employees.manage')
        entitlement = self.env['webvue.entitlement.service']
        entitlement.require('hr.enabled') if write else entitlement.require_read('hr.enabled')

    @api.model
    def _webvue_department_context_available(self):
        entitlement = self.env['webvue.entitlement.service']
        return entitlement._webvue_feature_read('hr.enabled') and self.env[
            'webvue.access.service'
        ]._webvue_has_capability(self.env.user, 'hr.departments.read')

    @api.model
    def _webvue_require_department_context(self, *, write=False):
        self.env['webvue.access.service']._webvue_require_capability(
            'hr.departments.read',
        )
        entitlement = self.env['webvue.entitlement.service']
        if write:
            # Normal document create/update also checks documents.enabled under
            # its own profile/policy locks. Provider ownership remains in HR.
            entitlement.require('hr.enabled')
        else:
            entitlement.require_read('hr.enabled')

    @api.model
    def _webvue_context_definitions(self):
        return (
            *super()._webvue_context_definitions(),
            {
                'kind': 'hr.department',
                'field': 'department_id',
                'name_ar': 'القسم',
                'name_en': 'Department',
                'available': self._webvue_department_context_available(),
            },
            {
                'kind': 'hr.employee', 'field': 'employee_id',
                'name_ar': 'الموظف', 'name_en': 'Employee',
                'available': self._webvue_employee_context_available(),
            },
        )

    @api.model
    def _webvue_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
        if kind == 'hr.employee':
            self._webvue_require_employee_context()
            domain = [('company_id', '=', self.env.company.id)]
            if record_id is not None:
                domain.append(('id', '=', record_id))
            if q:
                domain.append(('name', 'ilike', q))
            employees = self.env['hr.employee']
            return {
                'items': [{'id': item.id, 'name': item.name} for item in employees.search(
                    domain, limit=limit, offset=offset, order='name,id',
                )],
                'total': employees.search_count(domain),
            }
        if kind != 'hr.department':
            return super()._webvue_context_options(kind, q, limit, offset, record_id=record_id)
        self._webvue_require_department_context()
        domain = [('company_id', '=', self.env.company.id)]
        if record_id is not None:
            domain.append(('id', '=', record_id))
        if q:
            domain.append(('name', 'ilike', q))
        departments = self.env['hr.department']
        return {
            'items': [
                {'id': item.id, 'name': item.name}
                for item in departments.search(
                    domain, limit=limit, offset=offset, order='name,id',
                )
            ],
            'total': departments.search_count(domain),
        }

    @api.model
    def _webvue_prepare_context(self, context):
        if context is None:
            return {'department_id': False, 'employee_id': False}
        if context.get('kind') == 'hr.employee':
            if set(context) != {'kind', 'id'}:
                msg = 'invalid'
                raise WebVueAccessRule(msg, 'invalid employee context', field='context')
            self.env['webvue.document']._webvue_check_employee(context['id'])
            return {'employee_id': context['id'], 'department_id': False}
        if context.get('kind') != 'hr.department':
            return super()._webvue_prepare_context(context)
        if set(context) != {'kind', 'id'}:
            msg = 'invalid'
            raise WebVueAccessRule(
                msg, 'invalid department context', field='context',
            )
        self.env['webvue.document']._webvue_check_department(context['id'])
        return {'department_id': context['id'], 'employee_id': False}

    @api.model
    def _webvue_dump_contexts(self, documents):
        result = super()._webvue_dump_contexts(documents)
        # The owning aggregate has authorized this bounded page as one batch.
        # Resolve HR labels only through ordinary, company-scoped provider ACLs.
        departments = self.env['hr.department'].browse()
        if self._webvue_department_context_available():
            departments = self.env['hr.department'].search([
                ('id', 'in', documents.department_id.ids),
                ('company_id', '=', self.env.company.id),
            ])
        names = {department.id: department.name for department in departments}
        employees = self.env['hr.employee.public'].browse()
        if self.env['webvue.entitlement.service']._webvue_feature_read('hr.enabled') and self.env[
            'webvue.access.service'
        ]._webvue_has_capability(self.env.user, 'hr.employees.read'):
            employees = self.env['hr.employee.public'].search([
                ('id', 'in', documents.employee_id.ids),
                ('company_id', '=', self.env.company.id),
            ])
        employee_names = {employee.id: employee.name for employee in employees}
        own_ids = set(employees.filtered(lambda employee: employee.user_id == self.env.user).ids)
        for document in documents:
            employee_id = document.employee_id.id
            if employee_id:
                name = employee_names.get(employee_id)
                result[document.id] = {
                    'kind': 'hr.employee', 'id': employee_id, 'label': name,
                    'href': ('/account/profile' if employee_id in own_ids else f'/hr/employees/{employee_id}') if name else None,
                }
                continue
            department_id = document.department_id.id
            if department_id:
                name = names.get(department_id)
                result[document.id] = {
                    'kind': 'hr.department', 'id': department_id, 'label': name,
                    'href': f'/hr/departments/{department_id}' if name else None,
                }
        return result
