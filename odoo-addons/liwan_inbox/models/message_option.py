# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanInboxMessageOption(models.Model):
    """One reply button or list row of an outbound interactive message."""
    _name = 'liwan.inbox.message.option'
    _inherit = 'liwan.inbox.option'
    _description = 'Customer Inbox interactive option'
    _liwan_scope = 'company'

    message_id = fields.Many2one('liwan.inbox.message', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='message_id.company_id', store=True, index=True)
