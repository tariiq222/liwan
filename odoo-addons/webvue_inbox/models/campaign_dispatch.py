# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The campaign dispatcher (cron): freezes the audience, then turns pending recipients into queued template messages."""
import logging
import re
from functools import partial

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.fields import Domain

from .batch import process_each
from .campaign_constants import (
    DISPATCH_ATTEMPTS,
    MEDIA_MAX_AGE_DAYS,
    PREPARE_FAILURES,
    WHATSAPP_ADDRESS_DIGITS,
)
from .constants import CAMPAIGN_IN_FLIGHT, CAMPAIGNS_FEATURE, SNAPSHOT_CHUNK
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_inbox.adapters import whatsapp

_logger = logging.getLogger(__name__)
ADDRESS = re.compile(r'^\d{%d,%d}$' % WHATSAPP_ADDRESS_DIGITS)
ACCOUNT_BLOCKED = ('restricted', 'disabled')


class WebVueInboxCampaignDispatch(models.Model):
    _inherit = 'webvue.inbox.campaign'

    @api.model
    def _webvue_run_campaigns(self):
        """Start due campaigns, free the paused ones' queued messages, then advance every running campaign by one step."""
        if not self.env['webvue.entitlement.service']._webvue_feature_write(CAMPAIGNS_FEATURE):
            return
        self._webvue_release_inactive()
        self.search([('state', '=', 'scheduled'), ('scheduled_at', '<=', fields.Datetime.now())]).write({'state': 'running'})
        run = {'used': {}}
        for campaign in self.search([('state', '=', 'running')], order='launched_at, id'):
            try:
                with self.env.cr.savepoint():
                    selected, media_id = campaign._webvue_prepare(run)
            except Exception as error:  # noqa: BLE001 - one campaign's failure must not stop the others
                campaign._webvue_prepare_failed(error)
                continue
            if campaign.prepare_failures:
                campaign.prepare_failures = 0
            if selected:
                process_each(selected, partial(campaign._webvue_dispatch_one, media_id=media_id), self._webvue_dispatch_failed)
                self.env['webvue.inbox.message']._webvue_wake_outbox()
            campaign._webvue_finish_if_done()

    @api.model
    def _webvue_release_inactive(self):
        """Delete the never-sent, queued messages of paused and cancelled campaigns, so their recipients are pending again and uncounted."""
        inactive = self.search([('state', 'in', ('paused', 'cancelled'))])
        queued = self.env['webvue.inbox.message'].search([
            ('campaign_recipient_ids.campaign_id', 'in', inactive.ids), ('delivery_state', '=', 'queued'),
            ('provider_message_id', '=', False),
        ])._webvue_lock_available()  # a message the outbox is sending right now stays; the next run reaches it
        recipients = queued.campaign_recipient_ids
        queued.unlink()
        recipients._webvue_reset()  # a recipient given back is pending again and not counted against the monthly limit

    def _webvue_prepare_failed(self, error):
        """Count an unexpected failure of a dispatcher step; the campaign pauses after a few in a row instead of failing forever."""
        failures = self.prepare_failures + 1
        _logger.warning('campaign %s could not advance (%s in a row): %s', self.id, failures, type(error).__name__)
        self.prepare_failures = failures
        if failures >= PREPARE_FAILURES:
            self.prepare_failures = 0
            self._webvue_pause('token', self.env._('The campaign could not advance: %(error)s', error=type(error).__name__))

    def _webvue_prepare(self, run):
        """Guards, snapshot step and budget of one running campaign: (the recipients to queue now, the header media id)."""
        self.ensure_one()
        none = (self.env['webvue.inbox.campaign.recipient'], None)
        if not self._webvue_pause_if_blocked():
            return none
        if not self.snapshot_done:
            self._webvue_snapshot_step()
        return (self._webvue_select_batch(run) if self.snapshot_done else None) or none

    def _webvue_pause_if_blocked(self):
        """True when the campaign may send; otherwise pauses it with the reason."""
        self.ensure_one()
        problem = self._webvue_template_problem()
        if problem:
            self._webvue_pause('template_unavailable', problem)
        elif self.channel_id.state == 'disabled':
            self._webvue_pause('channel_disabled')
        elif self.channel_id.account_state in ACCOUNT_BLOCKED:
            self._webvue_pause('account_restricted', self.env._('The WhatsApp account is %(state)s.', state=self.channel_id.account_state))
        else:
            return True
        return False

    # snapshot

    def _webvue_snapshot_step(self):
        """Freeze the next chunk of the audience as recipients; the campaign is ready to send when no contact is left."""
        self.ensure_one()
        Recipient = self.env['webvue.inbox.campaign.recipient']
        self.env.flush_all()
        self.env.cr.execute('SELECT COALESCE(MAX(contact_id), 0) FROM webvue_inbox_campaign_recipient WHERE campaign_id = %s', [self.id])
        last = self.env.cr.fetchone()[0]
        contacts = self.env['webvue.inbox.contact'].search(
            self.audience_id._webvue_contact_domain() & Domain('id', '>', last),
            order='id', limit=SNAPSHOT_CHUNK,
        )
        if not contacts:
            self.snapshot_done = True
            return
        policy = self.env['webvue.inbox.settings']._get_for_company(self.company_id).consent_policy
        Recipient.create([self._webvue_recipient_values(contact, policy) for contact in contacts])
        if len(contacts) < SNAPSHOT_CHUNK:
            self.snapshot_done = True
        else:
            self._webvue_wake()

    def _webvue_recipient_values(self, contact, policy):
        identity = contact.identity_ids.filtered(lambda row: row.channel_kind == 'whatsapp')[:1]
        address = identity.address or False
        values = {'campaign_id': self.id, 'contact_id': contact.id, 'address': address}
        reason = self._webvue_skip_reason(contact, address, policy)
        if reason:
            values['skip_reason'] = reason
        return values

    def _webvue_skip_reason(self, contact, address, policy):
        """Why `contact` is not messaged (None when they are): number, consent under the policy, parameters."""
        if not address or not ADDRESS.match(address):
            return 'invalid_number'
        if contact.marketing_consent == 'opted_out':
            return 'opted_out'
        if policy == 'opted_in_only' and contact.marketing_consent != 'opted_in':
            return 'no_consent'
        if self._webvue_resolve(contact) is None:
            return 'missing_param'
        return None

    # sending

    def _webvue_select_batch(self, run):
        """(pending recipients to queue now, header media id), or None when nothing may be sent this run."""
        self.ensure_one()
        settings = self.env['webvue.inbox.settings']._get_for_company(self.company_id)
        if self.send_within_hours and not settings._webvue_is_open(fields.Datetime.now()):
            return None
        Recipient = self.env['webvue.inbox.campaign.recipient']
        budget = CAMPAIGN_IN_FLIGHT - Recipient.search_count([('campaign_id', '=', self.id), ('state', '=', 'queued')])
        if self.daily_cap:
            budget = min(budget, self.daily_cap - self._webvue_dispatched_24h())
        messages_room, recipients_room = self._webvue_limit_rooms()
        for reason, room in (('messages_limit', messages_room), ('recipients_limit', recipients_room)):
            if room is None:
                continue
            if room <= 0:
                if Recipient.search_count([('campaign_id', '=', self.id), ('state', '=', 'pending')], limit=1):
                    self._webvue_pause(reason)
                    self._webvue_release_inactive()
                return None
            budget = min(budget, room)
        if budget <= 0:
            return None
        pending = Recipient.search([('campaign_id', '=', self.id), ('state', '=', 'pending')], order='id', limit=budget)
        selected = self._webvue_within_tier(pending, run)
        if not selected:
            return None
        try:
            return selected, self._webvue_header_media()
        except whatsapp.ProviderError as error:
            if not error.retryable:
                self._webvue_pause('template_unavailable', str(error))
            return None

    def _webvue_within_tier(self, pending, run):
        """The pending recipients that fit the messaging limit's remaining budget (shared by the channels of one business account)."""
        channel = self.channel_id
        if channel.business_account_id not in run['used']:
            run['used'][channel.business_account_id] = channel._webvue_used_addresses()
        used = run['used'][channel.business_account_id]
        cap = channel._webvue_tier_cap()
        selected = self.env['webvue.inbox.campaign.recipient']
        for recipient in pending:
            if recipient.address not in used:
                if cap is not None and len(used) >= cap:
                    break
                used.add(recipient.address)
            selected |= recipient
        return selected

    def _webvue_header_media(self):
        """The WhatsApp media id of the campaign's header file, uploaded once (None for a template without a media header)."""
        self.ensure_one()
        if self.template_id.header_type not in ('image', 'video', 'document'):
            return None
        stale = self.header_media_uploaded_at and self.header_media_uploaded_at < fields.Datetime.now() - relativedelta(days=MEDIA_MAX_AGE_DAYS)
        if not self.header_media_id or stale:
            attachment = self.header_attachment_id
            self.write({
                'header_media_id': whatsapp.upload_media(
                    self.channel_id._webvue_credentials(), attachment.name, attachment.mimetype, attachment.raw,
                ),
                'header_media_uploaded_at': fields.Datetime.now(),
            })
        return self.header_media_id

    def _webvue_consent_skip(self, contact):
        policy = self.env['webvue.inbox.settings']._get_for_company(self.company_id).consent_policy
        if contact.marketing_consent == 'opted_out':
            return 'opted_out'
        return 'no_consent' if policy == 'opted_in_only' and contact.marketing_consent != 'opted_in' else None

    def _webvue_dispatch_one(self, recipient, media_id=None):
        """Queue the template message of one recipient (re-checking consent and parameters at the last moment)."""
        contact = recipient.contact_id
        reason = self._webvue_consent_skip(contact)
        resolved = None if reason else self._webvue_resolve(contact)
        if reason or resolved is None:
            recipient.skip_reason = reason or 'missing_param'
            return
        message = self._webvue_queue(self._webvue_conversation(contact, recipient.address), resolved, media_id)
        recipient.write({'message_id': message.id, 'dispatched_at': fields.Datetime.now()})
        recipient._webvue_sync_outcome()

    def _webvue_queue(self, conversation, resolved, media_id=None, wake=False):
        """Queue the campaign template for `conversation`; the message is automated, so it has no author and ends no customer wait."""
        body, header, buttons = resolved
        if self.template_id.header_type in ('image', 'video', 'document'):
            header = {'attachment': self.header_attachment_id}
        return self.env['webvue.inbox.message']._webvue_queue_template(
            conversation, self.template_id, body, header, buttons,
            extra={'automated': True, 'author_id': False, 'media_id': media_id or False}, wake=wake,
        )

    def _webvue_conversation(self, contact, address):
        """The contact's open conversation on the channel, or a new one that starts resolved (out of the agents' open queue)."""
        Identity = self.env['webvue.inbox.contact.identity']
        identity = Identity.search([
            ('company_id', '=', self.company_id.id), ('channel_kind', '=', self.channel_id.kind), ('address', '=', address),
        ], limit=1) or Identity.create({
            'company_id': self.company_id.id, 'contact_id': contact.id, 'channel_kind': self.channel_id.kind, 'address': address,
        })
        Conversation = self.env['webvue.inbox.conversation']
        return Conversation.search([
            ('channel_id', '=', self.channel_id.id), ('identity_id', '=', identity.id), ('state', '!=', 'closed'),
        ], limit=1) or Conversation.create({
            'company_id': self.company_id.id, 'channel_id': self.channel_id.id, 'contact_id': identity.contact_id.id,
            'identity_id': identity.id, 'department_id': self.channel_id.department_id.id, 'state': 'resolved',
        })

    @api.model
    def _webvue_dispatch_failed(self, recipient, error):
        """A recipient the engine refuses (a closed conversation, a bad value) is skipped; an unknown error is retried a few times.

        A limit reached mid-batch leaves the recipient pending: the next run pauses the campaign on it.
        """
        _logger.warning('recipient %s was not queued: %s', recipient.id, type(error).__name__)
        if isinstance(error, WebVueAccessRule):
            return
        if isinstance(error, (UserError, ValidationError)):
            recipient.skip_reason = 'invalid_number'
            return
        recipient.dispatch_attempts += 1
        if recipient.dispatch_attempts >= DISPATCH_ATTEMPTS:
            recipient.skip_reason = 'invalid_number'

    def _webvue_finish_if_done(self):
        self.ensure_one()
        if self.state == 'running' and self.snapshot_done and not self.env['webvue.inbox.campaign.recipient'].search_count([
            ('campaign_id', '=', self.id), ('state', 'in', ('pending', 'queued')),
        ], limit=1):
            self.write({'state': 'done', 'completed_at': fields.Datetime.now()})

    # test send

    def _webvue_send_test(self, contact):
        """Send the campaign's template once to `contact` (an agent's check, not a recipient); returns the queued message."""
        self.ensure_one()
        problem = self._webvue_template_problem() or self._webvue_params_problem()
        if problem:
            raise ValidationError(problem)
        if self.channel_id.state != 'connected':
            raise ValidationError(self.env._('The channel is not connected.'))
        identity = contact.identity_ids.filtered(lambda row: row.channel_kind == 'whatsapp')[:1]
        if not identity:
            raise ValidationError(self.env._('The contact has no WhatsApp number.'))
        if self._webvue_consent_skip(contact):
            raise ValidationError(self.env._('The contact has not agreed to marketing messages under the consent policy.'))
        resolved = self._webvue_resolve(contact)
        if resolved is None:
            raise ValidationError(self.env._('A placeholder has no value for this contact.'))
        media_id = self._webvue_header_media()
        return self._webvue_queue(self._webvue_conversation(contact, identity.address), resolved, media_id, wake=True)
