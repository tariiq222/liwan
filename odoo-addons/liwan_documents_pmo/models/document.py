# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.tools import SQL

from odoo.addons.liwan_api.controllers.common import ApiError


class Document(models.Model):
    _inherit = 'liwan.document'

    project_id = fields.Many2one('project.project', index=True, check_company=True, ondelete='restrict')

    @api.model
    def _liwan_context_fields(self):
        return (*super()._liwan_context_fields(), 'project_id')

    @api.model
    def _liwan_document_projects(self, *, write):
        entitlement = self.env['liwan.entitlement.service']
        feature = entitlement._liwan_feature_write if write else entitlement._liwan_feature_read
        projects = self.env['project.project'].with_context(active_test=False)
        domain = [('company_id', '=', self.env.company.id)]
        access = self.env['liwan.access.service']
        if not feature('pmo.enabled') or not access._liwan_has_capability(self.env.user, 'pmo.projects.read'):
            domain.append(('id', '=', False))
        elif write:
            domain.append(('active', '=', True))
            if not access._liwan_has_capability(self.env.user, 'pmo.projects.manage'):
                domain.append(('user_id', '=', self.env.uid))
        return projects, domain

    @api.model
    def _liwan_project_document_scope(self, operation):
        projects, domain = self._liwan_document_projects(write=operation != 'read')
        if not projects.has_access('read'):
            return None
        return SQL('d.project_id IN (%s)', projects._search(domain).select())

    @api.model
    def _liwan_scope_predicate(self, operation):
        scope = super()._liwan_scope_predicate(operation)
        project_scope = self._liwan_project_document_scope(operation)
        if scope is None:
            return project_scope
        if project_scope is None:
            return scope
        return SQL('(%s) OR (%s)', scope, project_scope)

    @api.model
    def _liwan_context_restriction(self, operation):
        restriction = super()._liwan_context_restriction(operation)
        project_scope = self._liwan_project_document_scope(operation)
        return SQL('(%s) AND (d.project_id IS NULL OR (%s))', restriction, project_scope or SQL('FALSE'))

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.user._is_superuser():
            links = self.env['liwan.document.links']
            for vals in vals_list:
                if vals.get('project_id'):
                    links._liwan_managed_context('project', vals['project_id'], write=True)
        return super().create(vals_list)

    def write(self, vals):
        if 'project_id' in vals and not self.env.user._is_superuser():
            if any(document.project_id.id != vals['project_id'] for document in self):
                msg = 'The project of a managed document cannot be changed.'
                raise AccessError(self.env._(msg))
        return super().write(vals)


class DocumentLinks(models.AbstractModel):
    _inherit = 'liwan.document.links'

    @api.model
    def _liwan_context_definitions(self):
        entitlement = self.env['liwan.entitlement.service']
        access = self.env['liwan.access.service']
        return (*super()._liwan_context_definitions(), {
            'kind': 'project.project', 'field': 'project_id', 'name_ar': 'المشروع', 'name_en': 'Project',
            'available': entitlement._liwan_feature_read('pmo.enabled')
            and access._liwan_has_capability(self.env.user, 'pmo.projects.read'),
        })

    @api.model
    def _liwan_context_options(self, kind, q=None, limit=20, offset=0, *, record_id=None):
        if kind != 'project.project':
            return super()._liwan_context_options(kind, q, limit, offset, record_id=record_id)
        projects, domain = self.env['liwan.document']._liwan_document_projects(write=True)
        if not projects.has_access('read'):
            return {'items': [], 'total': 0}
        if q:
            domain.append(('name', 'ilike', q[:200]))
        if record_id is not None:
            domain.append(('id', '=', record_id))
        return {'items': [{'id': project.id, 'name': project.name} for project in projects.search(
            domain, limit=limit, offset=offset, order='name,id',
        )], 'total': projects.search_count(domain)}

    @api.model
    def _liwan_managed_context_features(self):
        return (*super()._liwan_managed_context_features(), 'pmo.enabled')

    @api.model
    def _liwan_managed_context(self, kind, subject_id, *, write=False):
        if kind != 'project':
            return super()._liwan_managed_context(kind, subject_id, write=write)
        self._liwan_require_context_feature('pmo.enabled', write=write)
        self.env['liwan.access.service']._liwan_require_capability('pmo.projects.read')
        projects, domain = self.env['liwan.document']._liwan_document_projects(write=write)
        project = projects.search([*domain, ('id', '=', subject_id)], limit=1)
        if not project:
            raise ApiError(404, 'not_found', 'Document context not found.')
        return 'project.project', [('project_id', '=', project.id)]

    @api.model
    def _liwan_prepare_context(self, context):
        if context and context.get('kind') == 'project.project':
            _, domain = self._liwan_managed_context('project', context['id'], write=True)
            return {'project_id': domain[0][2]}
        return super()._liwan_prepare_context(context)

    @api.model
    def _liwan_dump_contexts(self, documents):
        contexts = super()._liwan_dump_contexts(documents)
        for document in documents:
            project = document.project_id
            if project:
                contexts[document.id] = {
                    'kind': 'project.project', 'id': project.id, 'label': project.name,
                    'href': f'/projects/{project.id}',
                }
        return contexts
