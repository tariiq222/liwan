# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanTasksDirectory(models.AbstractModel):
    _inherit = 'liwan.directory'

    @api.model
    def _liwan_directory_feature_keys(self):
        # Tasks pick assignees.
        return (*super()._liwan_directory_feature_keys(), 'tasks.enabled')
