# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

MAINTENANCE_CAPABILITY = 'settings.maintenance.manage'


class LiwanMaintenanceAccessService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return (*super()._liwan_capability_definitions(), {'key': MAINTENANCE_CAPABILITY, 'owner': 'liwan_platform'})

    @api.model
    def _liwan_builtin_role_grants(self):
        grants = super()._liwan_builtin_role_grants()
        grants['liwan_core.role_system_admin'] = {*grants['liwan_core.role_system_admin'], MAINTENANCE_CAPABILITY}
        return grants

    @api.model
    def _liwan_legacy_capability_keys(self, user):
        keys = super()._liwan_legacy_capability_keys(user)
        if user.has_group('liwan_core.group_customer_admin') or user.has_group('liwan_platform.group_maintenance_manager'):
            keys = {*keys, MAINTENANCE_CAPABILITY}
        return keys
