# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanPaymentsFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {'key': 'payments.enabled', 'type': 'boolean', 'owner': 'liwan_payments', 'module': 'liwan_payments'},
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + ({'id': 'liwan_payments'},)
