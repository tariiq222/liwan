# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoFeatureRegistry(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
            {
                'key': 'pmo.enabled',
                'type': 'boolean',
                'owner': 'nasq_pmo',
                'module': 'nasq_pmo',
            },
            {
                'key': 'projects.max_projects',
                'type': 'limit',
                'owner': 'nasq_pmo',
                'module': 'nasq_pmo',
            },
        )

    @api.model
    def _nasq_module_definitions(self):
        return super()._nasq_module_definitions() + (
            {'id': 'nasq_pmo'},
        )
