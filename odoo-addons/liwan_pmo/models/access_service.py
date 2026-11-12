# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve', 'pmo.finance.read',
})
EMPLOYEE_PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
})
PROJECT_SCOPE = 'project'
FINANCE_READ_PERMISSION = 'pmo.finance.read'
PROJECT_CONTEXTUAL_PERMISSIONS = frozenset({
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve', FINANCE_READ_PERMISSION,
})
PMO_PERMISSION_DEPENDENCIES = {
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read', FINANCE_READ_PERMISSION},
    FINANCE_READ_PERMISSION: {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
}


class LiwanPmoAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple(
            {'key': key, 'owner': 'liwan_pmo'}
            for key in sorted(PMO_PERMISSIONS)
        )

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key, required in PMO_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role_xmlid, keys in (
            ('liwan_pmo.role_pmo_manager', PMO_PERMISSIONS),
            ('liwan_core.role_employee', EMPLOYEE_PMO_PERMISSIONS),
            ('liwan_core.role_vendor_support', PMO_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if (
            user.has_group('liwan_pmo.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PMO_PERMISSIONS
        return keys

    @api.model
    def _liwan_legacy_admin_roles(self):
        return [*super()._liwan_legacy_admin_roles(), 'pmo_manager']

    @api.model
    def _liwan_record_company(self, record):
        if 'company_id' not in record._fields and 'project_id' in record._fields:
            return record.project_id.company_id
        return super()._liwan_record_company(record)

    @api.model
    def _liwan_contextual_capability(self, user, key, record):
        if key == FINANCE_READ_PERMISSION:
            project = record if record._name == 'project.project' else record.project_id
            return bool(project) and self._liwan_project_finance_reader(user, project)
        if key in PROJECT_CONTEXTUAL_PERMISSIONS:
            if record._name == 'project.task':
                task = record.with_user(user)
                if task.has_access('read'):
                    # A readable task does not imply its private project is
                    # readable. Inspect only whether this actor is the manager,
                    # scoped to that task and its permitted owning company.
                    manager_domain = Domain([
                        ('user_id', '=', user.id), ('company_id', '=', task.company_id.id),
                    ])
                    if task.search_count(
                        Domain([('id', '=', task.id), ('company_id', 'in', task.env.companies.ids)])
                        & Domain('project_id', 'any!', manager_domain),
                    ):
                        return True
            else:
                project = record if record._name == 'project.project' else record.project_id
                if project and project.user_id == user:
                    return True
        return super()._liwan_contextual_capability(user, key, record)

    @api.model
    def _liwan_project_finance_reader(self, user, project):
        """The project's manager, or a member of it when the company widened the readers to its members.

        The ``members`` choice is the company's explicit grant: membership only selects the scope, and the
        member still has to hold ``pmo.projects.read``.
        """
        if project.user_id == user:
            return True
        company = project.company_id or self.env.company
        if self.env['liwan.pmo.settings'].with_company(company)._core_values()['finance_readers'] != 'members':
            return False
        return self._liwan_has_capability(user, 'pmo.projects.read', company=company) and project.with_user(user)._liwan_is_member()

    @api.model
    def _liwan_scope_kinds(self):
        return {**super()._liwan_scope_kinds(), PROJECT_SCOPE: {
            'owner': 'liwan_pmo',
            'permissions': PROJECT_CONTEXTUAL_PERMISSIONS,
            'roles': {
                'project_owner': {
                    'name': {'ar': 'مسؤول مشروع', 'en': 'Project owner'},
                    'grants': PROJECT_CONTEXTUAL_PERMISSIONS,
                },
                'project_creation_policy': {
                    'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                    'grants': frozenset({'pmo.projects.create'}),
                },
            },
        }}

    @api.model
    def _liwan_contextual_role_held(self, kind, role_key, user, capabilities):
        if kind != PROJECT_SCOPE:
            return super()._liwan_contextual_role_held(kind, role_key, user, capabilities)
        company = self.env.company
        if role_key == 'project_owner':
            return 'pmo.projects.read' in capabilities and bool(
                self.env['project.project'].with_user(user).search_count([
                    ('user_id', '=', user.id), ('company_id', '=', company.id),
                ]),
            )
        if role_key == 'project_creation_policy':
            return (
                self._liwan_is_employee_principal(user, company=company)
                and self.env['liwan.pmo.settings'].with_user(user)._core_values()['project_creators'] == 'employees'
            )
        return super()._liwan_contextual_role_held(kind, role_key, user, capabilities)
