# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqMeetingsDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        # Meetings pick organizers, secretaries and attendees.
        return (*super()._nasq_directory_feature_keys(), 'meetings.enabled')
