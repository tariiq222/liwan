# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class LiwanInboxContact(models.Model):
    """A person who writes to the company on a channel; once an action needs a customer, linked to one."""
    _name = 'liwan.inbox.contact'
    _description = 'Customer Messages contact'
    _order = 'name, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    phone = fields.Char()
    email = fields.Char()
    identity_ids = fields.One2many('liwan.inbox.contact.identity', 'contact_id')
    conversation_ids = fields.One2many('liwan.inbox.conversation', 'contact_id')
    # The customer (a liwan_customers party) this contact is, linked the first time an action needs one.
    partner_id = fields.Many2one('res.partner', ondelete='set null')

    @api.model
    def _liwan_phone_from_address(self, address):
        """E.164 form of a WhatsApp id (digits only)."""
        return '+' + address

    def _liwan_customer(self, customer_id=None, create_new=False):
        """The customer of this contact, resolved by liwan.customers.service as the caller and linked on first use.

        A contact linked to an active party the caller sees keeps it. Otherwise (no link, or a link to a partner that
        is no party, is archived or is hidden) ``customer_id`` names an existing customer, ``create_new`` asks for a
        new one, and without either a customer is made from the contact's name and phone unless customers with that
        phone exist, which answers 409 ``conflict`` with them. A contact with no phone (TikTok) is made from its name
        alone.
        """
        self.ensure_one()
        linked = self._liwan_linked_customer()
        if linked:
            return linked
        service = self.env['liwan.customers.service']
        values = None if customer_id is not None else self._liwan_customer_values()
        self.partner_id = service._liwan_resolve(customer_id=customer_id, values=values, create_new=create_new)
        return self.partner_id

    def _liwan_linked_customer(self):
        """The linked partner when it is an active party the caller sees, else no partner."""
        if not self.partner_id:
            return self.partner_id
        return self.env['res.partner'].search([('id', '=', self.partner_id.id), ('liwan_party', '=', True)], limit=1)

    def _liwan_customer_values(self):
        """The identity of a new customer made from this contact; its phone in E.164, read as a channel address."""
        values = {'name': self.name}
        if self.phone:
            values['phone'] = self.env['liwan.customers.service']._liwan_normalize_phone(self.phone, channel=True)
        return values


class LiwanInboxContactIdentity(models.Model):
    """How a contact is addressed on one channel kind (the WhatsApp id)."""
    _name = 'liwan.inbox.contact.identity'
    _description = 'Customer Messages contact identity'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    contact_id = fields.Many2one('liwan.inbox.contact', required=True, index=True, ondelete='cascade')
    channel_kind = fields.Selection([('whatsapp', 'WhatsApp'), ('tiktok', 'TikTok')], required=True)
    address = fields.Char(required=True)

    _address_unique = models.Constraint(
        'UNIQUE(company_id, channel_kind, address)', 'An address belongs to one contact per company and channel kind.',
    )
