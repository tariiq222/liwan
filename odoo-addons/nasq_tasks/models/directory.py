# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class NasqTasksDirectory(models.AbstractModel):
    _inherit = 'nasq.directory'

    @api.model
    def _nasq_directory_feature_keys(self):
        # Tasks pick assignees.
        return (*super()._nasq_directory_feature_keys(), 'tasks.enabled')
