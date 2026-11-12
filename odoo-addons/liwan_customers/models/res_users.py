# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.constrains('partner_id')
    def _check_partner_is_not_a_party(self):
        # A user's email and phone are account identity (sign-in codes are mailed to the partner's email): a customer
        # record that staff may edit must never become one.
        if self.partner_id.filtered('liwan_party'):
            msg = 'liwan_party_account: a customer cannot be the contact of a user'
            raise ValidationError(msg)
