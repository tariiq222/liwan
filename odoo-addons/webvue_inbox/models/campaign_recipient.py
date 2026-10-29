# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One contact of a campaign, frozen when the campaign starts: what happened to their message, and what they did next."""
from odoo import api, fields, models

from .campaign_constants import ERROR_HANDLING, FAILURES, RECIPIENT_STATES, SKIP_REASONS
from .constants import FREQUENCY_RETRY_AFTER, UNSUBSCRIBE_ATTRIBUTION


class WebVueInboxCampaignRecipient(models.Model):
    _name = 'webvue.inbox.campaign.recipient'
    _description = 'Customer Inbox campaign recipient'
    _order = 'id'
    _webvue_scope = 'company'

    campaign_id = fields.Many2one('webvue.inbox.campaign', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='campaign_id.company_id', store=True, index=True)
    contact_id = fields.Many2one('webvue.inbox.contact', required=True, index=True, ondelete='restrict')
    # The WhatsApp id frozen at the snapshot (empty for a contact without a WhatsApp address).
    address = fields.Char()
    message_id = fields.Many2one('webvue.inbox.message', index=True, ondelete='set null')
    skip_reason = fields.Selection(SKIP_REASONS)
    # What happened to the message, copied here whenever the message changes: the outcome outlives the message, which the
    # retention purge deletes, so a delivered message never turns back into a pending recipient.
    outcome = fields.Selection([state for state in RECIPIENT_STATES if state[0] not in ('pending', 'skipped')], index=True)
    state = fields.Selection(RECIPIENT_STATES, compute='_compute_state', store=True, index=True)
    failure = fields.Selection(FAILURES, index=True)
    error_code = fields.Integer()
    error = fields.Char(size=200)
    sent_at = fields.Datetime()
    dispatched_at = fields.Datetime(index=True)
    dispatch_attempts = fields.Integer(default=0)
    replied_at = fields.Datetime()
    unsubscribed_at = fields.Datetime()

    _campaign_contact_unique = models.Constraint('UNIQUE(campaign_id, contact_id)', 'A contact is a recipient once per campaign.')
    _campaign_address_unique = models.Constraint('UNIQUE(campaign_id, address)', 'A number is a recipient once per campaign.')

    @api.depends('skip_reason', 'outcome')
    def _compute_state(self):
        for recipient in self:
            recipient.state = 'skipped' if recipient.skip_reason else (recipient.outcome or 'pending')

    def _webvue_sync_outcome(self):
        """Copy the message's delivery outcome onto the recipients that point at it."""
        for recipient in self.filtered('message_id'):
            message = recipient.message_id
            failed = message.delivery_state == 'failed'
            handling = ERROR_HANDLING.get(message.error_code)
            recipient.write({
                'outcome': message.delivery_state, 'sent_at': message.date,
                'failure': ((handling.failure if handling and handling.failure else 'other') if failed else False),
                'error_code': message.error_code or False, 'error': (message.error or False) if failed else False,
            })

    def _webvue_reset(self):
        """Give the recipient back to pending: no message, no outcome, not counted as dispatched."""
        self.write({
            'message_id': False, 'outcome': False, 'failure': False, 'error_code': False, 'error': False, 'sent_at': False,
            'dispatched_at': False,
        })

    @api.model
    def _webvue_count_dispatched_this_month(self):
        """Recipients dispatched since the start of this UTC month (the usage of the monthly recipients limit)."""
        self.env.cr.execute(
            'SELECT count(*) FROM webvue_inbox_campaign_recipient WHERE dispatched_at >= %s',
            [self.env['webvue.inbox.message']._webvue_month_start()],
        )
        return self.env.cr.fetchone()[0]

    def _webvue_can_retry(self):
        self.ensure_one()
        return self.failure == 'frequency_capped' and bool(self.sent_at) and self.sent_at <= fields.Datetime.now() - FREQUENCY_RETRY_AFTER

    # delivery outcome

    def _webvue_on_failed(self):
        """Apply the Meta error code of the failed message: consent, a campaign pause, or a return to pending."""
        for recipient in self:
            message = recipient.message_id
            handling = ERROR_HANDLING.get(message.error_code)
            if not handling:
                continue
            campaign = recipient.campaign_id
            if handling.consent:
                recipient.contact_id._webvue_record_consent('opted_out', 'delivery_error', note=message.error, campaign=campaign)
                recipient.unsubscribed_at = fields.Datetime.now()
            if handling.pause and campaign.state == 'running':
                campaign._webvue_pause(handling.pause, message.error)
            if handling.reupload:
                campaign.write({'header_media_id': False, 'header_media_uploaded_at': False})
            if handling.release:
                recipient._webvue_reset()
                if campaign.state == 'done':
                    campaign.write({'state': 'running', 'completed_at': False})

    # attribution of what the customer did after the message

    @api.model
    def _webvue_latest_for_contact(self, contact):
        return self.search([('contact_id', '=', contact.id), ('message_id', '!=', False)], order='dispatched_at desc, id desc', limit=1)

    @api.model
    def _webvue_latest_for_conversation(self, conversation, before):
        """The conversation's newest campaign recipient whose message was sent at or before `before`."""
        return self.search([
            ('message_id.conversation_id', '=', conversation.id), ('sent_at', '<=', before),
        ], order='dispatched_at desc, id desc', limit=1)

    def _webvue_mark_unsubscribed(self, at=None):
        """Record the unsubscribe on the recipient when it happened within a week of the message."""
        now = at or fields.Datetime.now()
        for recipient in self:
            if not recipient.unsubscribed_at and recipient.sent_at and now - recipient.sent_at <= UNSUBSCRIBE_ATTRIBUTION:
                recipient.unsubscribed_at = now
