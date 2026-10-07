# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqPmoDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        # Projects pick owners, assignees and stakeholders.
        return (*super()._nasq_directory_feature_keys(), 'pmo.enabled')
