# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueIntegrationsFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'integrations.enabled',
                'type': 'boolean',
                'owner': 'webvue_integrations_sa',
                'module': 'webvue_integrations_sa',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_integrations_sa'},
        )
