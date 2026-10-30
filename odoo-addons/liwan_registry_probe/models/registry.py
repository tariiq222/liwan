# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanRegistryProbeAccess(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_capability_definitions(self):
        return super()._liwan_capability_definitions() + (
            {'key': 'probe.inspect', 'owner': 'liwan_registry_probe'},
        )


class LiwanRegistryProbeFeatures(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'probe.enabled',
                'type': 'boolean',
                'owner': 'liwan_registry_probe',
                'module': 'liwan_registry_probe',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_registry_probe'},
        )
