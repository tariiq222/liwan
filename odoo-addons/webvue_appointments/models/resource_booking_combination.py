# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ResourceBookingCombination(models.Model):
    _inherit = 'resource.booking.combination'

    # The engine's combination has no company: it takes the company of the types it serves.
    company_id = fields.Many2one(
        'res.company', required=True, index=True, default=lambda self: self.env.company,
    )

    @api.constrains('company_id')
    def _check_types_company(self):
        self.type_rel_ids._check_type_company()
