# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

AI_USE = 'ai.use'
EMPLOYEE_PERMISSIONS = frozenset({AI_USE})


class LiwanAiAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + ({'key': AI_USE, 'owner': 'liwan_ai'},)

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        grants['liwan_core.role_employee'] = grants.get('liwan_core.role_employee', set()) | EMPLOYEE_PERMISSIONS
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
