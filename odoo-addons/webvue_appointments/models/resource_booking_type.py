# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ResourceBookingType(models.Model):
    _inherit = 'resource.booking.type'

    # The engine allows a company-less type, visible to every company; WebVue types
    # belong to one company (database-per-tenant still hosts several companies).
    company_id = fields.Many2one(required=True, default=lambda self: self.env.company)

    @api.constrains('company_id')
    def _check_combinations_company(self):
        self.combination_rel_ids._check_type_company()
