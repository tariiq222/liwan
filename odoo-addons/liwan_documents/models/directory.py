# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class DocumentsDirectory(models.AbstractModel):
    _inherit = 'liwan.directory'

    @api.model
    def _liwan_directory_has_base_consumer(self):
        return True
