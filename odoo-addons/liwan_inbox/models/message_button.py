# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .template import BUTTON_KINDS


class LiwanInboxMessageButton(models.Model):
    """A button of a template reply as it was sent, with the value the agent filled into it (if it takes one)."""
    _name = 'liwan.inbox.message.button'
    _description = 'Customer Inbox template reply button'
    _order = 'position, id'
    _liwan_scope = 'company'

    message_id = fields.Many2one('liwan.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
    # The button's index in the template, as WhatsApp addresses it.
    position = fields.Integer(required=True)
    kind = fields.Selection(BUTTON_KINDS, required=True)
    text = fields.Char()
    # A link suffix, a coupon code or a one-time code; empty for a button that takes none.
    value = fields.Char()
