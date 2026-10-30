# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanInboxMessageOrderLine(models.Model):
    """One line of a customer's cart as WhatsApp sent it (the retailer id, quantity and the price the cart showed)."""
    _name = 'liwan.inbox.message.order.line'
    _description = 'Customer Inbox cart line'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    message_id = fields.Many2one('liwan.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    retailer_id = fields.Char(required=True)
    quantity = fields.Integer(required=True)
    item_price = fields.Float(digits=(16, 4), required=True)
    currency = fields.Char(required=True, size=3)
