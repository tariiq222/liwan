# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanInboxConversationCycle(models.Model):
    _inherit = 'liwan.inbox.conversation.cycle'

    @api.model
    def _liwan_open_for(self, conversation, at):
        """The inbound ingestion calls this for every live customer message after the survey and history checks, so a
        channel set to open opportunities automatically sees exactly the messages it should and never an import."""
        super()._liwan_open_for(conversation, at)
        conversation._liwan_auto_opportunity()
