# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePmoDirectory(models.AbstractModel):
    _inherit = 'webvue.directory'

    @api.model
    def _webvue_directory_feature_keys(self):
        # Projects pick owners, assignees and stakeholders.
        return (*super()._webvue_directory_feature_keys(), 'pmo.enabled')
