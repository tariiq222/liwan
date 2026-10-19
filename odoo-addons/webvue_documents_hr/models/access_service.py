# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class AccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        key = 'webvue_hr.role_hr_manager'
        grants[key] = grants.get(key, set()) | {
            'documents.items.read',
            'documents.items.manage',
        }
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_hr.group_hr_manager') or user.has_group(
            'hr.group_hr_manager',
        ):
            keys |= {'documents.items.read', 'documents.items.manage'}
        return keys
