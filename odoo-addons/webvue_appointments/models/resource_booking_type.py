# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ResourceBookingType(models.Model):
    _inherit = 'resource.booking.type'

    # The engine allows a company-less type, visible to every company; WebVue types
    # belong to one company (database-per-tenant still hosts several companies).
    company_id = fields.Many2one(required=True, default=lambda self: self.env.company)

    @api.model
    def default_get(self, fields_list):
        defaults = super().default_get(fields_list)
        type_defaults = self.env['webvue.appointment.settings']._webvue_type_defaults()
        for name, value in type_defaults.items():
            if name in fields_list and 'default_' + name not in self.env.context:
                defaults[name] = value
        return defaults

    @api.constrains('company_id')
    def _check_combinations_company(self):
        self.combination_rel_ids._check_type_company()
