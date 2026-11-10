# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError
from odoo.fields import Domain

from .project_tools import (
    check_tool_fields,
    tool_domain_fields,
    tool_group_domain,
    tool_read_fields,
)


class ProjectChildVisibility(models.AbstractModel):
    _name = 'liwan.project.child.visibility'
    _description = 'Caller-scoped project child visibility'
    _liwan_tool_key = None
    _liwan_tool_field_map = {}
    _liwan_required_features = ()
    _liwan_allow_archived_projects = False
    _liwan_governance_task_mode = None

    _liwan_read_only_company_path = 'project_id.company_id'

    def read(self, fields=None, load='_classic_read'):
        return super().read(tool_read_fields(self, fields), load=load)

    def export_data(self, fields_to_export):
        check_tool_fields(self, fields_to_export)
        return super().export_data(fields_to_export)

    @api.model
    @api.readonly
    def read_group(self, domain, fields, groupby, offset=0, limit=None, orderby=False, lazy=True):
        domain = tool_group_domain(self, domain, [*fields, *(groupby if isinstance(groupby, list) else [groupby]), orderby or ''])
        return super().read_group(domain, fields, groupby, offset=offset, limit=limit, orderby=orderby, lazy=lazy)

    @api.model
    @api.readonly
    def formatted_read_group(self, domain, groupby=(), aggregates=(), having=(), offset=0, limit=None, order=None):
        domain = tool_group_domain(self, domain, [*groupby, *aggregates, *tool_domain_fields(having), order or ''])
        return super().formatted_read_group(domain, groupby, aggregates, having, offset, limit, order)

    def _liwan_visibility_domain(self):
        # Odoo evaluates ir.rule domains with sudo, including relational `any`.
        # Build the related queries in the original caller environment instead.
        # Query objects remain SQL subqueries; no ids or environments are cached.
        if any(not self.env['liwan.entitlement.service']._liwan_feature_read(key) for key in self._liwan_required_features):
            return Domain.FALSE
        Project = self.env['project.project']
        project_domain = Domain([('active', '=', True), ('company_id', 'in', self.env.companies.ids)])
        if self._liwan_tool_key:
            project_domain &= Project._liwan_tool_domain(self._liwan_tool_key)
        projects = (Project._liwan_archived_child_project_query() if self._liwan_allow_archived_projects
                    else Project._search(project_domain))
        domain = Domain('project_id', 'in', projects)
        if self._liwan_governance_task_mode:
            try:
                tasks = self.env['project.task']._search([
                    ('active', '=', True), ('company_id', 'in', self.env.companies.ids),
                    ('project_id.active', '=', True),
                ])
                task_domain = Domain('task_id', 'in', tasks)
            except AccessError:
                task_domain = Domain.FALSE
            if self._liwan_governance_task_mode == 'optional':
                task_domain |= Domain('task_id', '=', False)
            domain &= task_domain
        return domain

    @api.model
    def _search(self, domain, offset=0, limit=None, order=None, *, active_test=True, bypass_access=False):
        if not self.env.su:
            names = tool_domain_fields(domain) + [order or '']
            domain = tool_group_domain(self, domain, names) & self._liwan_visibility_domain()
        return super()._search(domain, offset=offset, limit=limit, order=order, active_test=active_test, bypass_access=bypass_access)

    def _check_access(self, operation):
        denied = super()._check_access(operation)
        if denied or self.env.su or not any(self._ids):
            return denied
        # This hook also protects field fetch/read, has_access and cached rows.
        # The empty-record ACL check inside _search does not recurse here.
        visible = self.browse(self._search([('id', 'in', self.ids)]))
        forbidden = self - visible
        if forbidden:
            return forbidden, lambda: AccessError(self.env._("Project records require readable projects and tasks in the allowed companies."))
        return None

    def _liwan_check_manage(self):
        self.check_access('read')
        self._liwan_check_visible()
        for record in self:
            record.project_id._liwan_check_manage()
            if not record.project_id.active:
                msg = 'Archived projects are read-only.'
                raise AccessError(msg)
            if self._liwan_tool_key:
                record.project_id._liwan_check_tool_write(self._liwan_tool_key)
        return self
