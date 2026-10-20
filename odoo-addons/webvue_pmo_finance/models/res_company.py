# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    webvue_pmo_finance_cost_center_mode = fields.Selection(
        [('auto', 'Automatic'), ('manual', 'Manual')], string='Project cost centers', default='manual',
        help="Automatic creates a cost center for every new project; manual leaves each project to choose its own.",
    )
