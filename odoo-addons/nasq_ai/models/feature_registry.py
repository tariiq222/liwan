# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqAiFeatureRegistry(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
            {'key': 'ai.enabled', 'type': 'boolean', 'owner': 'nasq_ai', 'module': 'nasq_ai'},
            {'key': 'ai.messages.monthly', 'type': 'limit', 'owner': 'nasq_ai', 'module': 'nasq_ai'},
            {'key': 'ai.tool_calls.per_run', 'type': 'limit', 'owner': 'nasq_ai', 'module': 'nasq_ai'},
        )

    @api.model
    def _nasq_module_definitions(self):
        return super()._nasq_module_definitions() + ({'id': 'nasq_ai'},)
