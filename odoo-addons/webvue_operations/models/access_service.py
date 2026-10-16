# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PERMISSIONS = frozenset(['operations.requests.read', 'operations.requests.create', 'operations.requests.review', 'operations.monitoring.read', 'operations.processes.manage'])
EMPLOYEE_PERMISSIONS = frozenset({'operations.requests.read', 'operations.requests.create'})
MANAGER_PERMISSIONS = EMPLOYEE_PERMISSIONS | {'operations.monitoring.read', 'operations.processes.manage'}
REVIEWER_PERMISSIONS = EMPLOYEE_PERMISSIONS | {'operations.requests.review'}


class WebVueOperationsAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_keys(self, user=None, company=None):
        user = user or self.env.user
        keys = super()._webvue_capability_keys(user, company=company)
        # Support's foundation shortcut must not grant approval/configuration
        # rights merely because a new application registered its capabilities.
        return keys - PERMISSIONS if user.has_group('webvue_core.group_vendor_support') else keys

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple({'key': key, 'owner': 'webvue_operations'} for key in sorted(PERMISSIONS))

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key in PERMISSIONS - {'operations.requests.read'}:
            dependencies[key] = dependencies.get(key, set()) | {'operations.requests.read'}
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        for role, keys in [('webvue_core.role_employee', EMPLOYEE_PERMISSIONS), ('webvue_operations.role_operations_manager', MANAGER_PERMISSIONS), ('webvue_operations.role_operations_reviewer', REVIEWER_PERMISSIONS)]:
            grants[role] = grants.get(role, set()) | keys
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        if user.has_group('webvue_operations.group_operations_manager'):
            keys |= MANAGER_PERMISSIONS
        if user.has_group('webvue_operations.group_operations_reviewer'):
            keys |= REVIEWER_PERMISSIONS
        return keys
