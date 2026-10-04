# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError


class NasqPlatformResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su and any(vals.get('parent_id') for vals in vals_list):
            raise AccessError(self.env._('branch_requires_subscription'))
        return super().create(vals_list)
