# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueInboxMessageButtonParam(models.Model):
    """The value an agent filled into one button of a template reply: a link suffix, a coupon code or a one-time code."""
    _name = 'webvue.inbox.message.button.param'
    _description = 'Customer Inbox template button parameter'
    _order = 'position, id'
    _webvue_scope = 'company'

    message_id = fields.Many2one('webvue.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
    # The button's position among all buttons of the template, as WhatsApp's `index`.
    position = fields.Integer(required=True)
    # How WhatsApp takes the value: the suffix of a link button, or a copy-code button's coupon.
    sub_type = fields.Selection([('url', 'Link'), ('copy_code', 'Copy code')], required=True)
    value = fields.Char(required=True)
