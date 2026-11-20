# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset(['operations.requests.read', 'operations.requests.create', 'operations.requests.review', 'operations.monitoring.read', 'operations.processes.manage'])
EMPLOYEE_PERMISSIONS = frozenset({'operations.requests.read', 'operations.requests.create'})
MANAGER_PERMISSIONS = EMPLOYEE_PERMISSIONS | {'operations.monitoring.read', 'operations.processes.manage'}
REVIEWER_PERMISSIONS = EMPLOYEE_PERMISSIONS | {'operations.requests.review'}


class LiwanOperationsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + tuple({'key': key, 'owner': 'liwan_approval_service'} for key in sorted(PERMISSIONS))

    @api.model
    def _liwan_permission_dependencies(self):
        dependencies = super()._liwan_permission_dependencies()
        for key in PERMISSIONS - {'operations.requests.read'}:
            dependencies[key] = dependencies.get(key, set()) | {'operations.requests.read'}
        return dependencies

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        role = 'liwan_core.role_employee'
        grants[role] = grants.get(role, set()) | EMPLOYEE_PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
