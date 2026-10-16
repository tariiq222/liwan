# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueRegistryProbeAccess(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_capability_definitions(self):
        return super()._webvue_capability_definitions() + (
            {'key': 'probe.inspect', 'owner': 'webvue_registry_probe'},
        )


class WebVueRegistryProbeFeatures(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'probe.enabled',
                'type': 'boolean',
                'owner': 'webvue_registry_probe',
                'module': 'webvue_registry_probe',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_registry_probe'},
        )
