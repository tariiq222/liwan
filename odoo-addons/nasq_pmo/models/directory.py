# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        # Projects and meetings both pick people. Keep this order: with both
        # keys off the gate reports the last one, as it did before the move.
        # meetings.enabled moves to nasq_meetings in phase 2b-2.
        return (*super()._nasq_directory_feature_keys(), 'pmo.enabled', 'meetings.enabled')
