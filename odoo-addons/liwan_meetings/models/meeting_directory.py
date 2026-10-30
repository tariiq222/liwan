# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanMeetingsDirectory(models.AbstractModel):
    _inherit = 'liwan.directory'

    @api.model
    def _liwan_directory_feature_keys(self):
        # Meetings pick organizers, secretaries and attendees.
        return (*super()._liwan_directory_feature_keys(), 'meetings.enabled')
