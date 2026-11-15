# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM opportunity a conversation is about (the CRM/Customer Messages bridge)."""
from odoo import fields, models


class LiwanInboxConversationLead(models.Model):
    _inherit = 'liwan.inbox.conversation'

    # A conversation is a record of Customer Messages and stays valid without the opportunity, so deleting
    # the opportunity clears the link; archiving it changes nothing. Only the bridge's routes write it.
    lead_id = fields.Many2one('crm.lead', string='Opportunity', index='btree_not_null', ondelete='set null', copy=False)
