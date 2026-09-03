# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    font = fields.Selection(
        selection_add=[('IBM_Plex_Sans_Arabic', 'IBM Plex Sans Arabic')],
        default='IBM_Plex_Sans_Arabic',
        ondelete={'IBM_Plex_Sans_Arabic': 'set default'},
    )
