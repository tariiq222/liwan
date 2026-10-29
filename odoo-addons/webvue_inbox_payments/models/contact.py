# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueInboxContact(models.Model):
    _inherit = 'webvue.inbox.contact'

    # The accounting partner of a customer who was sent a pay link, made on the first checkout.
    partner_id = fields.Many2one('res.partner', ondelete='set null')

    def _webvue_partner(self):
        """The partner of this contact, made from its name and phone on first use, in the contact's company.

        Stock gives employees read-only access to partners, so the create is the one elevated step; it
        carries server values only.
        """
        self.ensure_one()
        if not self.partner_id:
            partner = self.env['res.partner'].sudo().with_company(self.company_id).create({
                'name': self.name, 'phone': self.phone or False, 'company_id': self.company_id.id,
            })
            self.partner_id = partner.id
        return self.partner_id
