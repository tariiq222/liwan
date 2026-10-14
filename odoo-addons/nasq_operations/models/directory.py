# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class OperationsDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        return (*super()._nasq_directory_feature_keys(), 'operations.enabled')
