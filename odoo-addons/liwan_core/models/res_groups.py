# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResGroups(models.Model):
    _inherit = 'res.groups'

    @api.model_create_multi
    def create(self, vals_list):
        result = super().create(vals_list)
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        return result

    def write(self, vals):
        result = super().write(vals)
        # Native implication or membership changes also affect legacy capability keys.
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        return result

    def unlink(self):
        result = super().unlink()
        self.env['liwan.access.service']._liwan_clear_branch_cache()
        return result
