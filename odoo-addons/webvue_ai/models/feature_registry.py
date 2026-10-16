# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueAiFeatureRegistry(models.AbstractModel):
    _inherit = 'webvue.feature.registry'

    @api.model
    def _webvue_feature_definitions(self):
        return super()._webvue_feature_definitions() + (
            {'key': 'ai.enabled', 'type': 'boolean', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
            {'key': 'ai.messages.monthly', 'type': 'limit', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
            {'key': 'ai.tool_calls.per_run', 'type': 'limit', 'owner': 'webvue_ai', 'module': 'webvue_ai'},
        )

    @api.model
    def _webvue_module_definitions(self):
        return super()._webvue_module_definitions() + ({'id': 'webvue_ai'},)
