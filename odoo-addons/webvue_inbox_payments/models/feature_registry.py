# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueInboxPaymentsFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {
                'key': 'inbox.catalog', 'type': 'boolean',
                'owner': 'webvue_inbox_payments', 'module': 'webvue_inbox_payments',
            },
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + ({'id': 'webvue_inbox_payments'},)
