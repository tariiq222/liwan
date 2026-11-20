# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class HelpdeskTicketConversation(models.Model):
    _inherit = 'helpdesk.ticket'

    # The conversation this ticket was raised from. The ticket stays the desk's record: the conversation outlives
    # or is deleted without touching it (retention deletes conversations), and the link is written only by the
    # bridge's route.
    liwan_conversation_id = fields.Many2one(
        'liwan.inbox.conversation', string='Conversation', index='btree_not_null', ondelete='set null', copy=False,
    )
