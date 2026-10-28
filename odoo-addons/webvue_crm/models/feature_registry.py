# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueCrmFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'crm.enabled',
                'type': 'boolean',
                'owner': 'webvue_crm',
                'module': 'webvue_crm',
            },
            {
                'key': 'crm.import',
                'type': 'boolean',
                'owner': 'webvue_crm',
                'module': 'webvue_crm',
            },
            {
                'key': 'crm.export',
                'type': 'boolean',
                'owner': 'webvue_crm',
                'module': 'webvue_crm',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + (
            {'id': 'webvue_crm'},
        )
