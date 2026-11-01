# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanPmoFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'pmo.enabled',
                'type': 'boolean',
                'owner': 'liwan_pmo',
                'module': 'liwan_pmo',
            },
            {
                'key': 'pmo.change_control',
                'type': 'boolean',
                'owner': 'liwan_pmo',
                'module': 'liwan_pmo',
            },
            {
                'key': 'projects.max_projects',
                'type': 'limit',
                'owner': 'liwan_pmo',
                'module': 'liwan_pmo',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_pmo'},
        )
