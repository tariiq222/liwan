# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError


class HrLeave(models.Model):
    _inherit = 'hr.leave'

    def write(self, vals):
        if vals.get('state') == 'cancel' and not self.env.is_superuser():
            raise AccessError(self.env._('Use the policy checked cancellation wizard.'))
        return super().write(vals)
