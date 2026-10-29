# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sending health of a channel for campaigns: the messaging-limit budget and the Marketing Messages API choice."""
from odoo import fields, models
from odoo.exceptions import UserError

from .campaign_constants import (
    DEFAULT_TIER_CAP,
    MARKETING_APIS,
    MARKETING_ONBOARDINGS,
    TIER_CAPS,
)
from .constants import ROLLING_DAY
from odoo.addons.webvue_inbox.adapters import whatsapp

# Unique customers messaged outside a service window, over every channel of one business account.
USED_ADDRESSES_SQL = """
    SELECT DISTINCT identity.address
      FROM webvue_inbox_message message
      JOIN webvue_inbox_conversation conversation ON conversation.id = message.conversation_id
      JOIN webvue_inbox_channel channel ON channel.id = conversation.channel_id
      JOIN webvue_inbox_contact_identity identity ON identity.id = conversation.identity_id
     WHERE message.direction = 'out' AND message.business_initiated AND message.delivery_state != 'failed'
       AND message.date >= %s AND channel.business_account_id = %s
"""


class WebVueInboxChannelSending(models.Model):
    _inherit = 'webvue.inbox.channel'

    marketing_api = fields.Selection(MARKETING_APIS, required=True, default='cloud_api')
    marketing_onboarding = fields.Selection(MARKETING_ONBOARDINGS, required=True, default='unknown')
    sending_checked_at = fields.Datetime()
    campaign_ids = fields.One2many('webvue.inbox.campaign', 'channel_id')

    def unlink(self):
        if self.campaign_ids:
            raise UserError(self.env._('A channel with campaigns cannot be deleted; disable it instead.'))
        return super().unlink()

    def _webvue_tier_cap(self):
        """Unique customers Meta lets the business message per rolling day (None: unlimited)."""
        self.ensure_one()
        return TIER_CAPS.get(self.messaging_limit, DEFAULT_TIER_CAP)

    def _webvue_used_addresses(self):
        """The WhatsApp ids messaged outside a service window in the last 24 hours over the channel's business account."""
        self.ensure_one()
        self.env.flush_all()
        self.env.cr.execute(USED_ADDRESSES_SQL, [fields.Datetime.now() - ROLLING_DAY, self.business_account_id])
        return {row[0] for row in self.env.cr.fetchall()}

    def _webvue_remaining_24h(self, used=None):
        """Customers that can still be messaged now (None: unlimited)."""
        self.ensure_one()
        cap = self._webvue_tier_cap()
        if cap is None:
            return None
        return max(cap - len(self._webvue_used_addresses() if used is None else used), 0)

    def _webvue_refresh_sending(self):
        """Read the number's tier and quality and the Marketing Messages API onboarding from Meta; a provider error propagates."""
        self.ensure_one()
        credentials = self._webvue_credentials()
        self._webvue_fetch_health()
        self.write({
            'marketing_onboarding': whatsapp.fetch_marketing_onboarding(credentials),
            'sending_checked_at': fields.Datetime.now(),
        })
