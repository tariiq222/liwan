# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule


class DocumentLinks(models.AbstractModel):
    _inherit = 'webvue.document.links'

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
        )

    @api.model
    def _webvue_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
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
            self._webvue_require_department_context(write=True)
            return {'department_id': False}
        if context.get('kind') != 'hr.department':
            return super()._webvue_prepare_context(context)
        if set(context) != {'kind', 'id'}:
            msg = 'invalid'
            raise WebVueAccessRule(
                msg, 'invalid department context', field='context',
            )
        self.env['webvue.document']._webvue_check_department(context['id'])
        return {'department_id': context['id']}

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
        for document in documents:
            department_id = document.department_id.id
            if department_id:
                name = names.get(department_id)
                result[document.id] = {
                    'kind': 'hr.department', 'id': department_id, 'label': name,
                    'href': f'/hr/departments/{department_id}' if name else None,
                }
        return result
