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
            # Platform-provider runs only: a tenant on its own key pays its provider and keeps the message limit alone.
            {'key': 'ai.tokens.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            {'key': 'ai.output_tokens.per_run', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
            # The free setup agent's monthly budget, set by the vendor in the package (spec 2026-11-04 §6.10).
            {'key': 'ai.setup.monthly', 'type': 'limit', 'owner': 'liwan_ai', 'module': 'liwan_ai'},
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + ({'id': 'liwan_ai'},)
