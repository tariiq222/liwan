# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

AI_USE = 'ai.use'
EMPLOYEE_PERMISSIONS = frozenset({AI_USE})


class WebVueAiAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + ({'key': AI_USE, 'owner': 'webvue_ai'},)

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        grants['webvue_core.role_employee'] = grants.get('webvue_core.role_employee', set()) | EMPLOYEE_PERMISSIONS
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
