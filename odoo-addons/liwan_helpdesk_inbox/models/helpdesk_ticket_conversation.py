# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.tools import SQL


class HelpdeskTicketConversation(models.Model):
    _inherit = 'helpdesk.ticket'

    # The conversation this ticket was raised from. The ticket stays the desk's record: the conversation outlives
    # or is deleted without touching it (retention deletes conversations), and the link is written only by the
    # bridge's route.
    liwan_conversation_id = fields.Many2one(
        'liwan.inbox.conversation', string='Conversation', index='btree_not_null', ondelete='set null', copy=False,
    )

    @api.model
    def _liwan_claim_conversation(self, conversation):
        """Serialize two moves to an open ticket of one conversation under Odoo's REPEATABLE READ.

        A no-op update writes a new version of the conversation row and holds its row lock until commit. A concurrent
        raise or reopen waits on that lock; once the first commits, the waiting update fails with a serialization
        error, and Odoo replays that request, whose fresh snapshot sees the first open ticket. A lock that writes
        nothing would not do: a request whose snapshot predates the first commit would take it afterwards and still
        count no open ticket.
        """
        # Raw SQL on the LiwanOS table: the caller holds no ORM write right on the conversation and must not be given
        # one, and the statement changes no value, so no field, compute or tracking is skipped.
        self.env.cr.execute(SQL(
            'UPDATE liwan_inbox_conversation SET write_date = write_date WHERE id = %s', conversation.id,
        ))

    @api.model_create_multi
    def create(self, vals_list):
        """Set the conversation link from the ``liwan_conversation_id`` context key, which the raise route passes.

        The desk's create service whitelists its values, so the link cannot go through it. The key is dropped before
        the real create so nothing created inside it, or by a later call on the same environment, takes the link.
        """
        conversation_id = self.env.context.get('liwan_conversation_id')
        if conversation_id:
            vals_list = [{'liwan_conversation_id': conversation_id, **vals} for vals in vals_list]
        return super(HelpdeskTicketConversation, self.with_context(liwan_conversation_id=False)).create(vals_list)

    def write(self, vals):
        if 'stage_id' in vals:
            stage = self.env['helpdesk.ticket.stage'].browse(vals['stage_id'])
            if not stage.closed:
                # A closed ticket of a conversation leaving its closed stage claims the conversation first, as a raise does.
                for conversation in self.filtered(lambda t: t.stage_id.closed).liwan_conversation_id:
                    self._liwan_claim_conversation(conversation)
        return super().write(vals)

    @api.constrains('stage_id', 'liwan_conversation_id')
    def _check_one_open_ticket_per_conversation(self):
        """One open ticket per conversation holds for a reopen too (owner decision 2026-11-20).

        The raise route refuses a second ticket while one is open; this covers the other way in, a closed ticket
        moving to an open stage while another ticket of its conversation is open. Odoo runs constraints on the sudo
        environment, so a ticket the desk's rules hide from the caller still counts, and the message names no ticket.
        """
        for ticket in self.filtered(lambda t: t.liwan_conversation_id and not t.stage_id.closed):
            if self.search_count([
                ('liwan_conversation_id', '=', ticket.liwan_conversation_id.id),
                ('stage_id.closed', '=', False), ('id', '!=', ticket.id),
            ], limit=1):
                raise ValidationError(self.env._('This conversation has another open ticket.'))
