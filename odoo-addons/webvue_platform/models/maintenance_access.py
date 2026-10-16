# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

MAINTENANCE_CAPABILITY = 'settings.maintenance.manage'


class WebVueMaintenanceAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return (*super()._webvue_capability_definitions(), {'key': MAINTENANCE_CAPABILITY, 'owner': 'webvue_platform'})

    @api.model
    def _webvue_builtin_role_grants(self):
        grants = super()._webvue_builtin_role_grants()
        grants['webvue_core.role_system_admin'] = {*grants['webvue_core.role_system_admin'], MAINTENANCE_CAPABILITY}
        return grants

    @api.model
    def _webvue_legacy_capability_keys(self, user):
        keys = super()._webvue_legacy_capability_keys(user)
        if user.has_group('webvue_core.group_customer_admin') or user.has_group('webvue_platform.group_maintenance_manager'):
            keys = {*keys, MAINTENANCE_CAPABILITY}
        return keys
