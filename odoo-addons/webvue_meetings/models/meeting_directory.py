# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVueMeetingsDirectory(models.AbstractModel):
    _inherit = 'webvue.directory'

    @api.model
    def _webvue_directory_feature_keys(self):
        # Meetings pick organizers, secretaries and attendees.
        return (*super()._webvue_directory_feature_keys(), 'meetings.enabled')
