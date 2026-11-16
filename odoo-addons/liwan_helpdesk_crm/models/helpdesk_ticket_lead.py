# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class HelpdeskTicketLead(models.Model):
    _inherit = 'helpdesk.ticket'

    # The opportunity a ticket belongs to (an after-sales issue of a sold deal). Archiving the opportunity keeps
    # the link; deleting it clears the field rather than the ticket. Only the bridge's route writes it.
    liwan_lead_id = fields.Many2one(
        'crm.lead', string='Opportunity', ondelete='set null', index='btree_not_null', copy=False,
    )
