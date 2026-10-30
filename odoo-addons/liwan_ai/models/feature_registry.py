# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanAiFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {'key': 'ai.enabled', 'type': 'boolean', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            {'key': 'ai.messages.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            {'key': 'ai.tool_calls.per_run', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + ({'id': 'liwan_ai'},)
