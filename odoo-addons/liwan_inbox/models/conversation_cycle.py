# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One open-to-end period of a conversation: the facts the reports measure (first response, resolution, survey)."""
from odoo import api, fields, models

END_REASONS = [('resolved', 'Resolved'), ('closed', 'Closed'), ('auto_closed', 'Closed automatically')]


class LiwanInboxConversationCycle(models.Model):
    """A conversation reopens and its own fields are overwritten, so each period keeps its own row."""
    _name = 'liwan.inbox.conversation.cycle'
    _description = 'Customer Inbox conversation cycle'
    _order = 'opened_at desc, id desc'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    conversation_id = fields.Many2one('liwan.inbox.conversation', required=True, index=True, ondelete='cascade')
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    department_id = fields.Many2one('liwan.inbox.department', ondelete='set null')
    opened_at = fields.Datetime(required=True, index=True)
    first_response_at = fields.Datetime(index=True)
    responder_id = fields.Many2one('res.users', ondelete='set null')
    ended_at = fields.Datetime(index=True)
    end_reason = fields.Selection(END_REASONS)
    resolver_id = fields.Many2one('res.users', ondelete='set null')
    csat_score = fields.Selection([('good', 'Good'), ('neutral', 'Neutral'), ('bad', 'Bad')])
    csat_at = fields.Datetime(index=True)
    first_response_seconds = fields.Integer(compute='_compute_seconds', store=True)
    resolution_seconds = fields.Integer(compute='_compute_seconds', store=True)

    _one_open_per_conversation = models.UniqueIndex(
        '(conversation_id) WHERE ended_at IS NULL', 'A conversation has one open cycle.',
    )

    @api.depends('opened_at', 'first_response_at', 'ended_at', 'end_reason')
    def _compute_seconds(self):
        for cycle in self:
            cycle.first_response_seconds = (
                int((cycle.first_response_at - cycle.opened_at).total_seconds()) if cycle.first_response_at else 0
            )
            cycle.resolution_seconds = (
                int((cycle.ended_at - cycle.opened_at).total_seconds()) if cycle.ended_at and cycle.end_reason == 'resolved' else 0
            )

    @api.model
    def _liwan_open_for(self, conversation, at):
        """Start the cycle that the inbound message at `at` opens, unless the conversation has one open."""
        if self.search_count([('conversation_id', '=', conversation.id), ('ended_at', '=', False)]):
            return
        self.create({
            'company_id': conversation.company_id.id, 'conversation_id': conversation.id, 'channel_id': conversation.channel_id.id,
            'department_id': conversation.department_id.id, 'opened_at': at,
        })

    @api.model
    def _liwan_end_for(self, conversations, reason):
        """End the open cycles of `conversations`; the resolver is the assignee at that moment."""
        for cycle in self.search([('conversation_id', 'in', conversations.ids), ('ended_at', '=', False)]):
            cycle.write({
                'ended_at': fields.Datetime.now(), 'end_reason': reason, 'resolver_id': cycle.conversation_id.assignee_id.id,
            })

    @api.model
    def _liwan_stamp_response(self, messages):
        """The agent's outbound `messages` answer the customers who wait: the first one of an open cycle is its first response."""
        for message in messages:
            cycle = self.search([
                ('conversation_id', '=', message.conversation_id.id), ('ended_at', '=', False),
                ('first_response_at', '=', False), ('opened_at', '<=', message.date),
            ], limit=1)
            if cycle:
                cycle.write({'first_response_at': message.date, 'responder_id': message.author_id.id})

    @api.model
    def _liwan_record_csat(self, conversation, score, at):
        """Put the customer's survey answer on the conversation's latest ended cycle."""
        cycle = self.search([('conversation_id', '=', conversation.id), ('ended_at', '!=', False)], order='ended_at desc, id desc', limit=1)
        cycle.write({'csat_score': score, 'csat_at': at})
