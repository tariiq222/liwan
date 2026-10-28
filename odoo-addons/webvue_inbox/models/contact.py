# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class WebVueInboxContact(models.Model):
    """A customer of the company. Deliberately not a res.partner."""
    _name = 'webvue.inbox.contact'
    _description = 'Customer Inbox contact'
    _order = 'name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    phone = fields.Char()
    email = fields.Char()
    identity_ids = fields.One2many('webvue.inbox.contact.identity', 'contact_id')
    conversation_ids = fields.One2many('webvue.inbox.conversation', 'contact_id')

    @api.model
    def _webvue_phone_from_address(self, address):
        """E.164 form of a WhatsApp id (digits only)."""
        return '+' + address


class WebVueInboxContactIdentity(models.Model):
    """How a contact is addressed on one channel kind (the WhatsApp id)."""
    _name = 'webvue.inbox.contact.identity'
    _description = 'Customer Inbox contact identity'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    contact_id = fields.Many2one('webvue.inbox.contact', required=True, index=True, ondelete='cascade')
    channel_kind = fields.Selection([('whatsapp', 'WhatsApp')], required=True)
    address = fields.Char(required=True)

    _address_unique = models.Constraint(
        'UNIQUE(company_id, channel_kind, address)', 'An address belongs to one contact per company and channel kind.',
    )
