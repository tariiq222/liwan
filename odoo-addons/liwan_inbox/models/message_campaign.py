# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanInboxMessageCampaign(models.Model):
    _inherit = 'liwan.inbox.message'

    # Meta's code of the failure (a send error or a status webhook).
    error_code = fields.Integer()
    # Meta answered the send with held_for_quality_assessment; a sent or delivered status clears it.
    held_for_quality = fields.Boolean(default=False)
    # A template queued while the conversation's service window was closed: it counts against the messaging limit.
    business_initiated = fields.Boolean(default=False, index=True)
    campaign_recipient_ids = fields.One2many('liwan.inbox.campaign.recipient', 'message_id')

    OUTCOME_FIELDS = frozenset({'delivery_state', 'error_code', 'error'})

    def write(self, vals):
        result = super().write(vals)
        if self.OUTCOME_FIELDS & vals.keys():
            self.campaign_recipient_ids._liwan_sync_outcome()
        return result

    def _liwan_lock_available(self):
        """The messages of this recordset whose row nobody else holds (and that still exist), now locked for this transaction.

        The outbox claims a campaign message before sending it, and the release of a paused campaign deletes only rows it
        can lock, so a message is never sent and deleted at the same time.
        """
        return self.try_lock_for_update()

    def _liwan_claim_campaign_send(self):
        """True when this campaign message may be sent now: locked, still queued and its campaign still running."""
        self.ensure_one()
        if not self._liwan_lock_available():
            return False
        self.invalidate_recordset()
        self.campaign_recipient_ids.invalidate_recordset()
        return self.delivery_state == 'queued' and all(
            recipient.campaign_id.state == 'running' for recipient in self.campaign_recipient_ids
        )
