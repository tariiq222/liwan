# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class InboxConversationTicket(models.Model):
    _inherit = 'liwan.inbox.conversation'

    # The support ticket raised from this conversation. The conversation stays the customer's channel: closing or
    # deleting the ticket leaves it, and the link is written only by the bridge's route.
    helpdesk_ticket_id = fields.Many2one(
        'helpdesk.ticket', string='Support ticket', index='btree_not_null', ondelete='set null', copy=False,
    )
