# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Whether a new conversation of a channel opens a CRM opportunity by itself (the CRM/Customer Messages bridge)."""
from odoo import fields, models

# The stable wire values of the setting (packages/contracts/src/crm/bridges.ts, ConversationOpportunityModeSchema).
OPPORTUNITY_MODES = [('manual', 'Manual'), ('auto_first_message', 'From the first message')]


class LiwanInboxChannelOpportunity(models.Model):
    _inherit = 'liwan.inbox.channel'

    # Per channel, so a tenant with a sales number and a support number opens opportunities from one only. Every
    # existing channel starts manual: the column default fills the rows, nothing is guessed.
    crm_opportunity_mode = fields.Selection(
        OPPORTUNITY_MODES, string='Opportunity from a new conversation', required=True, default='manual',
    )
