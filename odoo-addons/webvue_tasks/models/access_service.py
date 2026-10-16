# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The tasks application's capabilities, grants and legacy keys (spec R2), composed through super()."""
from odoo import api, models

PERMISSIONS = frozenset({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'})
# Every employee has a to-do list. system_admin and vendor_support get none implicitly.
EMPLOYEE_PERMISSIONS = PERMISSIONS
PERMISSION_DEPENDENCIES = {
    'tasks.tasks.create': {'tasks.tasks.read'},
    'tasks.tasks.write': {'tasks.tasks.read'},
}


class WebVueTasksAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + tuple(
            {'key': key, 'owner': 'webvue_tasks'} for key in sorted(PERMISSIONS)
        )

    @api.model
    def _webvue_permission_dependencies(self):
        dependencies = super()._webvue_permission_dependencies()
        for key, required in PERMISSION_DEPENDENCIES.items():
            dependencies[key] = dependencies.get(key, set()) | required
        return dependencies

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        role_xmlid = 'webvue_core.role_employee'
        grants[role_xmlid] = grants.get(role_xmlid, set()) | EMPLOYEE_PERMISSIONS
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
