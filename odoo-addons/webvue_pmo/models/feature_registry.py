# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePmoFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'pmo.enabled',
                'type': 'boolean',
                'owner': 'webvue_pmo',
                'module': 'webvue_pmo',
            },
            {
                'key': 'projects.max_projects',
                'type': 'limit',
                'owner': 'webvue_pmo',
                'module': 'webvue_pmo',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_pmo'},
        )
