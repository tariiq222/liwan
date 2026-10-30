# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanPmoDirectory(models.AbstractModel):
    _inherit = 'liwan.directory'

    @api.model
    def _liwan_directory_feature_keys(self):
        # Projects pick owners, assignees and stakeholders.
        return (*super()._liwan_directory_feature_keys(), 'pmo.enabled')
