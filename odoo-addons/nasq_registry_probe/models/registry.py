# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqRegistryProbeAccess(models.AbstractModel):
    _inherit = 'nasq.access.service'

    @api.model
    def _nasq_capability_definitions(self):
        return super()._nasq_capability_definitions() + (
            {'key': 'probe.inspect', 'owner': 'nasq_registry_probe'},
        )


class NasqRegistryProbeFeatures(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
            {
                'key': 'probe.enabled',
                'type': 'boolean',
                'owner': 'nasq_registry_probe',
                'module': 'nasq_registry_probe',
            },
        )

    @api.model
    def _nasq_module_definitions(self):
        return super()._nasq_module_definitions() + (
            {'id': 'nasq_registry_probe'},
        )
