# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    webvue_crm_package = fields.Boolean(string='CRM package', help='A sellable package of the CRM application.')
