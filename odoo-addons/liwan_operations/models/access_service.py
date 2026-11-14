# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_approval_service.models.access_service import (
    MANAGER_PERMISSIONS,
    REVIEWER_PERMISSIONS,
)


class LiwanOperationsAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        for role, keys in [('liwan_operations.role_operations_manager', MANAGER_PERMISSIONS), ('liwan_operations.role_operations_reviewer', REVIEWER_PERMISSIONS)]:
            grants[role] = grants.get(role, set()) | keys
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_operations.group_operations_manager'):
            keys |= MANAGER_PERMISSIONS
        if user.has_group('liwan_operations.group_operations_reviewer'):
            keys |= REVIEWER_PERMISSIONS
        return keys
