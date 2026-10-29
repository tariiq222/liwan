# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueInboxMessageOption(models.Model):
    """One reply button or list row of an outbound interactive message."""
    _name = 'webvue.inbox.message.option'
    _inherit = 'webvue.inbox.option'
    _description = 'Customer Inbox interactive option'
    _webvue_scope = 'company'

    message_id = fields.Many2one('webvue.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
