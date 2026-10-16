# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

AI_USE = 'ai.use'
EMPLOYEE_PERMISSIONS = frozenset({AI_USE})


class NasqAiAccessService(models.AbstractModel):
    _inherit = 'nasq.access.service'

    @api.model
    def _nasq_capability_definitions(self):
        return super()._nasq_capability_definitions() + ({'key': AI_USE, 'owner': 'nasq_ai'},)

    @api.model
    def _nasq_builtin_role_grants(self):
        grants = super()._nasq_builtin_role_grants()
        grants['nasq_core.role_employee'] = grants.get('nasq_core.role_employee', set()) | EMPLOYEE_PERMISSIONS
        return grants

    @api.model
    def _nasq_legacy_capability_keys(self, user):
        keys = super()._nasq_legacy_capability_keys(user)
        if user.has_group('nasq_core.group_employee'):
            keys |= EMPLOYEE_PERMISSIONS
        return keys
