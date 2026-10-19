# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueHrFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'hr.enabled',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
            {
                'key': 'hr.recruitment',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
            {
                'key': 'hr.shifts',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
            {
                'key': 'hr.onboarding',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
            {
                'key': 'hr.offboarding',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
            {
                'key': 'hr.assets',
                'type': 'boolean',
                'owner': 'webvue_hr',
                'module': 'webvue_hr',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_hr'},
        )
