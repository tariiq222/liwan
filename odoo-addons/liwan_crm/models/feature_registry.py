# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanCrmFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {
                'key': 'crm.enabled',
                'type': 'boolean',
                'owner': 'liwan_crm',
                'module': 'liwan_crm',
            },
            {
                'key': 'crm.import',
                'type': 'boolean',
                'owner': 'liwan_crm',
                'module': 'liwan_crm',
            },
            {
                'key': 'crm.export',
                'type': 'boolean',
                'owner': 'liwan_crm',
                'module': 'liwan_crm',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_crm'},
        )
