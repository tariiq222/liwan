# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
})
EMPLOYEE_PMO_PERMISSIONS = frozenset({
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
})
PROJECT_CONTEXTUAL_PERMISSIONS = frozenset({
    'pmo.projects.manage', 'pmo.tasks.write', 'pmo.tasks.approve',
})
PMO_PERMISSION_DEPENDENCIES = {
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
}


class NasqPmoAccessService(models.AbstractModel):
    _inherit = 'nasq.access.service'

    @api.model
    def _nasq_capability_definitions(self):
        return super()._nasq_capability_definitions() + tuple(
            {'key': key, 'owner': 'nasq_pmo'}
            for key in sorted(PMO_PERMISSIONS)
        )

    @api.model
    def _nasq_permission_dependencies(self):
        dependencies = super()._nasq_permission_dependencies()
        for key, required in PMO_PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _nasq_builtin_role_grants(self):
        grants = super()._nasq_builtin_role_grants()
        for role_xmlid, keys in (
            ('nasq_pmo.role_pmo_manager', PMO_PERMISSIONS),
            ('nasq_core.role_employee', EMPLOYEE_PMO_PERMISSIONS),
            ('nasq_core.role_vendor_support', PMO_PERMISSIONS),
        ):
            grants[role_xmlid] = grants.get(role_xmlid, set()) | keys
        return grants

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        keys = super()._nasq_legacy_capability_keys(user)
        if (
            user.has_group('nasq_pmo.group_pmo_manager')
            or user.has_group('project.group_project_manager')
        ):
            keys |= PMO_PERMISSIONS
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_PMO_PERMISSIONS
        return keys

    @api.model
    def _nasq_legacy_admin_roles(self):
        return [*super()._nasq_legacy_admin_roles(), 'pmo_manager']

    @api.model
    def _nasq_record_company(self, record):
        if 'company_id' not in record._fields and 'project_id' in record._fields:
            return record.project_id.company_id
        return super()._nasq_record_company(record)

    @api.model
    def _nasq_contextual_capability(self, user, key, record):
        if key in PROJECT_CONTEXTUAL_PERMISSIONS:
            project = record if record._name == 'project.project' else record.project_id
            if project and project.user_id == user:
                return True
        return super()._nasq_contextual_capability(user, key, record)

    @api.model
    def _nasq_identity_extra(self, user, capabilities):
        roles, extra = super()._nasq_identity_extra(user, capabilities)
        company = self.env.company
        if (
            'pmo.projects.read' in capabilities
            and self.env['project.project'].with_user(user).search_count([
                ('user_id', '=', user.id), ('company_id', '=', company.id),
            ])
        ):
            roles.append({
                'id': None, 'key': 'project_owner',
                'name': {'ar': 'مسؤول مشروع', 'en': 'Project owner'},
                'type': 'contextual', 'protected': True, 'source': 'project_owner',
            })
            extra |= PROJECT_CONTEXTUAL_PERMISSIONS
        if (
            self._nasq_is_employee_principal(user, company=company)
            and self.env['nasq.pmo.settings'].with_user(user).get()['project_creators'] == 'employees'
        ):
            roles.append({
                'id': None, 'key': 'project_creation_policy',
                'name': {'ar': 'سياسة إنشاء المشاريع', 'en': 'Project creation policy'},
                'type': 'contextual', 'protected': True, 'source': 'policy',
            })
            extra.add('pmo.projects.create')
        return roles, extra
