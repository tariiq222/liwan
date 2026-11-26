# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanTelephonyFeatureRegistry(models.AbstractModel):
    _inherit = 'liwan.feature.registry'

    @api.model
    def _liwan_feature_definitions(self):
        return super()._liwan_feature_definitions() + (
            {'key': 'telephony.enabled', 'type': 'boolean', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
            {'key': 'telephony.recording', 'type': 'boolean', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
            {'key': 'telephony.queues', 'type': 'boolean', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
            {'key': 'telephony.ivr', 'type': 'boolean', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
            {'key': 'telephony.extensions', 'type': 'limit', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
            {'key': 'telephony.recording_storage_mb', 'type': 'limit', 'owner': 'liwan_telephony',
             'module': 'liwan_telephony'},
        )

    @api.model
    def _liwan_module_definitions(self):
        return super()._liwan_module_definitions() + (
            {'id': 'liwan_telephony'},
        )
