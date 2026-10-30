# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanChatFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'chat.enabled',
                'type': 'boolean',
                'owner': 'liwan_chat',
                'module': 'liwan_chat',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_chat'},
        )
