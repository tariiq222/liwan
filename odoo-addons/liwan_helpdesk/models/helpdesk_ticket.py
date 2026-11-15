# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What LiwanOS adds to the OCA ticket.

The engine owns the ticket, its team, stage, category, tag, channel and SLA. The application adds the
three facts the engine has no place for: which internal user asked for the ticket (the self-service
requester, distinct from the customer contact), when an agent first answered it (the first-response
number the reports measure), and the tickets an agent declares related. Nothing here duplicates an
engine field.
"""
from odoo import fields, models

RELATED_RELATION = 'liwan_helpdesk_ticket_related_rel'


class HelpdeskTicket(models.Model):
    _inherit = 'helpdesk.ticket'

    # The employee who opened the ticket from their own workspace. A customer ticket leaves it empty and
    # uses the engine's partner_id. ondelete set null: removing an account keeps the ticket it asked for.
    liwan_requester_user_id = fields.Many2one(
        'res.users', string='Requested by', index='btree_not_null', ondelete='set null', copy=False,
    )
    # The first public answer of an agent: set once, by the service, when a reply is posted.
    liwan_first_response_at = fields.Datetime(string='First response', readonly=True, copy=False)
    liwan_related_ticket_ids = fields.Many2many(
        'helpdesk.ticket', RELATED_RELATION, 'ticket_id', 'related_id', string='Related tickets', copy=False,
    )
