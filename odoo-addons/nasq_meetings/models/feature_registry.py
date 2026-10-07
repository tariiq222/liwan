# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqMeetingsFeatureRegistry(models.AbstractModel):
    _inherit = 'nasq.feature.registry'

    @api.model
    def _nasq_feature_definitions(self):
        return super()._nasq_feature_definitions() + (
            {
                'key': 'meetings.enabled',
                'type': 'boolean',
                'owner': 'nasq_meetings',
                'module': 'nasq_meetings',
            },
        )

    @api.model
    def _nasq_module_definitions(self):
        return super()._nasq_module_definitions() + (
            {'id': 'nasq_meetings'},
        )
