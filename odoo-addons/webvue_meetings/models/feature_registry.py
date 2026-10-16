# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueMeetingsFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'meetings.enabled',
                'type': 'boolean',
                'owner': 'webvue_meetings',
                'module': 'webvue_meetings',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_meetings'},
        )
