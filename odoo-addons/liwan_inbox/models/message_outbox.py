# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import secrets

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .abstract_interactive import COMMERCE_TYPES
from .batch import process_each
from .constants import BACKOFF_MINUTES, MAX_ATTEMPTS, OUTBOX_BATCH, TYPING_MAX_AGE
from odoo.addons.liwan_inbox.adapters import errors, tiktok, whatsapp

_logger = logging.getLogger(__name__)
# A media send can spend an upload timeout and a read timeout before it finishes; a younger marker may still be in
# flight, so it is never settled. The outbox runs every minute, so a crashed one settles within a few runs.
STALE_SEND_AFTER = relativedelta(seconds=2 * whatsapp.UPLOAD_TIMEOUT_SECONDS + whatsapp.TIMEOUT_SECONDS)


class LiwanInboxMessageOutbox(models.Model):
    """The outbox cron: queued replies, then the reactions and read receipts waiting to be sent."""
    _inherit = 'liwan.inbox.message'

    @api.model
    def _liwan_run_outbox(self):
        self._liwan_settle_interrupted_sends()
        # Agent and automation messages always leave before campaign messages; a full batch asks for another run at once.
        # `answered` remembers, within this run, which messages the provider already took (see `_liwan_unexpected_failure`).
        answered = {}
        full = False
        for campaign in (False, True):
            due = self.search([
                ('direction', '=', 'out'), ('delivery_state', '=', 'queued'), ('send_token', '=', False),
                ('next_attempt_at', '<=', fields.Datetime.now()),
                *([('campaign_recipient_ids.campaign_id.state', '=', 'running')] if campaign else [('campaign_recipient_ids', '=', False)]),
            ], order='next_attempt_at, id', limit=OUTBOX_BATCH)
            drained = process_each(
                due, lambda message: message._liwan_deliver(answered),
                lambda message, error: self._liwan_unexpected_failure(message, error, answered),
                prepare=lambda message: message._liwan_prepare_send(),
            )
            # Only a drained full batch means there is more waiting; a run cut short by the time budget is
            # rescheduled by the cron itself, so asking for another run at once would only spin.
            full = full or (drained and len(due) == OUTBOX_BATCH)
            if not drained:
                return
        now = fields.Datetime.now()
        reactions = self.search([
            ('agent_reaction_pending', '=', True), '|', ('reaction_next_attempt_at', '=', False), ('reaction_next_attempt_at', '<=', now),
        ], limit=OUTBOX_BATCH)
        process_each(
            reactions, lambda message: message._liwan_send_reaction(),
            lambda message, _error: message._liwan_reaction_failed(retryable=True),
        )
        receipts = self.search([
            ('read_receipt', '=', 'pending'), '|', ('receipt_next_attempt_at', '=', False), ('receipt_next_attempt_at', '<=', now),
        ], limit=OUTBOX_BATCH)
        process_each(
            receipts, lambda message: message._liwan_send_read_receipt(),
            lambda message, _error: message._liwan_receipt_failed(retryable=True),
        )
        self._liwan_run_typing()
        if full:
            self._liwan_wake_outbox()

    @api.model
    def _liwan_run_typing(self):
        """Show the typing indicator of every pending request; one older than TYPING_MAX_AGE is dropped unsent."""
        Conversation = self.env['liwan.inbox.conversation']
        pending = Conversation.search([('typing_pending', '=', True)], limit=OUTBOX_BATCH)
        process_each(
            pending, self._liwan_send_typing, lambda conversation, _error: conversation.write({'typing_pending': False}),
        )

    @api.model
    def _liwan_send_typing(self, conversation):
        """The typing indicator; a failure is only logged."""
        conversation.typing_pending = False
        inbound = conversation._liwan_latest_inbound()
        if (not inbound or fields.Datetime.now() - conversation.typing_requested_at > TYPING_MAX_AGE
                or conversation._liwan_replied_since(conversation.typing_requested_at)):
            return
        channel = conversation.channel_id
        try:
            credentials = channel._liwan_credentials()
            if channel.kind == 'tiktok':
                tiktok.send_action(credentials, conversation.provider_conversation_id, 'TYPING')
            else:
                whatsapp.mark_read(credentials, inbound.provider_message_id, typing=True)
        except (errors.ProviderError, UserError) as error:
            _logger.warning('typing indicator of conversation %s failed: %s', conversation.id, type(error).__name__)
        else:
            # A WhatsApp read receipt travels with the typing indicator; TikTok marks a conversation read on its own.
            if channel.kind != 'tiktok':
                inbound.write({'read_receipt': 'sent', 'receipt_attempts': 0})

    @api.model
    def _liwan_unexpected_failure(self, message, error, answered=None):
        """An error outside the provider contract.

        Before the provider is called it is one retryable attempt. Once the provider has answered (`answered` holds
        the message id), the customer may have received it whatever failed afterwards, so it is marked unconfirmed
        and never sent again automatically: only an explicit retry sends it once more.
        """
        if not message.exists():  # a message deleted while the batch ran (a paused campaign's) is simply gone
            return
        if answered and message.id in answered:
            message._liwan_record_failure(
                self.env._('The provider accepted the message but its result could not be stored; '
                           'check it with the customer before retrying.'),
                retryable=False, unconfirmed=True,
            )
        else:
            message._liwan_record_failure(f'unexpected error: {type(error).__name__}', retryable=True)

    @api.model
    def _liwan_settle_interrupted_sends(self):
        """Settle the marker a worker that died mid-send left behind, before this run sends anything else.

        The provider may hold the message, so it is marked unconfirmed instead of being sent a second time. Only a
        queued outbound message can hold a marker, so a message that was stored as sent or failed is never touched.
        A marker younger than `STALE_SEND_AFTER` may still belong to an in-flight send and is left alone; the send
        query excludes every marker anyway, so leaving it costs a later pass, never a duplicate.
        """
        cutoff = fields.Datetime.now() - STALE_SEND_AFTER
        stuck = self.search([
            ('direction', '=', 'out'), ('delivery_state', '=', 'queued'), ('send_token', '!=', False),
            '|', ('send_started_at', '=', False), ('send_started_at', '<', cutoff),
        ], limit=OUTBOX_BATCH)
        process_each(
            stuck, lambda message: message._liwan_mark_send_interrupted(),
            lambda message, error: _logger.warning(
                'interrupted send of message %s could not be settled: %s', message.id, type(error).__name__,
            ),
        )

    def _liwan_prepare_send(self):
        """The durable marker of one send attempt, written and committed before the provider is called."""
        self.write({'send_token': secrets.token_hex(16), 'send_started_at': fields.Datetime.now()})

    def _liwan_clear_send_marker(self):
        """Drop the marker of a prepared attempt that will not call the provider."""
        self.write({'send_token': False, 'send_started_at': False})

    def _liwan_mark_send_interrupted(self):
        """A marker left by a hard crash: the provider may have the message, so it is not sent again."""
        when = fields.Datetime.to_string(self.send_started_at) if self.send_started_at else self.env._('an earlier run')
        self._liwan_record_failure(
            self.env._('A send attempt at %(when)s recorded no result; check it with the customer before retrying.',
                       when=when),
            retryable=False, unconfirmed=True,
        )

    def _liwan_deliver(self, answered=None):
        if not self.exists():
            return
        if self.campaign_recipient_ids and not self._liwan_claim_campaign_send():
            # Nothing is sent, so the prepared marker must not read as an interrupted send on the next run.
            self._liwan_clear_send_marker()
            return
        self._liwan_send(answered)
        self.conversation_id._liwan_notify_bus()

    def _liwan_send(self, answered=None):
        self.ensure_one()
        conversation = self.conversation_id
        if conversation.channel_id.state == 'disabled':
            self._liwan_record_failure(self.env._('The channel is disabled.'), retryable=False)
            return
        try:
            sent = self._liwan_provider_send()
        except errors.ProviderError as error:
            self._liwan_record_failure(str(error), error.retryable, error.code, unconfirmed=error.unconfirmed)
        except UserError as error:
            self._liwan_record_failure(str(error), retryable=False)
        else:
            if answered is not None:
                answered[self.id] = True  # the provider has it: whatever fails from here on is never a retry
            self._liwan_mark_sent(sent)

    def _liwan_mark_sent(self, sent):
        self.write({
            'delivery_state': 'sent', 'provider_message_id': sent.provider_id, 'held_for_quality': sent.held,
            'attempts': self.attempts + 1, 'error': False, 'error_code': False, 'unconfirmed': False,
            'send_token': False, 'send_started_at': False,
        })

    def _liwan_provider_send(self):
        """Send this message and return the whatsapp.SendResult (provider message id, held for a quality check)."""
        conversation = self.conversation_id
        if conversation.channel_id.kind == 'tiktok':
            return self._liwan_tiktok_provider_send(conversation)
        credentials = conversation.channel_id._liwan_credentials()
        to = conversation.identity_id.address
        context_id = self.reply_to_id.provider_message_id or None
        if self.template_name:
            if not self.template_id:
                raise UserError(self.env._('The template was removed by the provider.'))
            return whatsapp.send_template(
                credentials, to, self.template_name, self.template_language, self.template_params or [],
                header=self._liwan_template_header(credentials), buttons=self._liwan_template_buttons(),
                marketing_api=conversation.channel_id.marketing_api == 'marketing_messages' and self.template_id.category == 'marketing',
            )
        if self.kind == 'location':
            location = whatsapp.Location(self.latitude, self.longitude, self.location_name or None, self.location_address or None)
            provider_id = whatsapp.send_location(credentials, to, location, context_id)
        elif self.kind in COMMERCE_TYPES:
            if not self.catalog_id:
                raise UserError(self.env._('No catalog is connected to this channel.'))
            provider_id = whatsapp.send_commerce(credentials, to, self._liwan_commerce(), self.catalog_id, context_id)
        elif self.kind == 'interactive':
            flow = {'flow_id': self.flow_id.provider_flow_id, 'token': self.flow_token} if self.interactive_type == 'flow' else None
            provider_id = whatsapp.send_interactive(credentials, to, self._liwan_interactive(), context_id, flow=flow)
        elif self.kind in whatsapp.MEDIA_KINDS:
            provider_id = self._liwan_send_media(credentials, to, context_id)
        else:
            provider_id = whatsapp.send_text(credentials, to, self.body, context_id)
        return whatsapp.SendResult(provider_id, held=False)

    def _liwan_tiktok_provider_send(self, conversation):
        """A text, an image or a button card to the conversation's TikTok id (the card title is its body)."""
        credentials = conversation.channel_id._liwan_credentials()
        target = conversation.provider_conversation_id
        if self.kind == 'image':
            return whatsapp.SendResult(tiktok.send_image(credentials, target, self._liwan_tiktok_media_id(credentials)), held=False)
        if self.interactive_type == 'buttons':
            buttons = [tiktok.Button(option.option_id, option.title) for option in self.option_ids.sorted('sequence')]
            return whatsapp.SendResult(tiktok.send_buttons(credentials, target, self.body, buttons), held=False)
        context_id = self.reply_to_id.provider_message_id or None
        return whatsapp.SendResult(tiktok.send_text(credentials, target, self.body, context_id), held=False)

    def _liwan_tiktok_media_id(self, credentials):
        """The TikTok media id of this message's image; it is uploaded once and kept for retries."""
        if not self.media_id:
            attachment = self._liwan_file()
            self.media_id = tiktok.upload_image(credentials, attachment.name, attachment.mimetype, attachment.raw)
        return self.media_id

    def _liwan_send_media(self, credentials, to, context_id):
        media_id = self._liwan_media_id(credentials)
        attachment = self._liwan_file()
        return whatsapp.send_media(
            credentials, to, self.kind, media_id, self._liwan_caption(), attachment.name, context_id,
        )

    def _liwan_file(self):
        attachment = self.env['ir.attachment'].search([('res_model', '=', self._name), ('res_id', '=', self.id)], limit=1)
        if not attachment:
            raise UserError(self.env._('The file of this message is missing.'))
        return attachment

    def _liwan_media_id(self, credentials):
        """The WhatsApp media id of this message's file; it is uploaded once and kept for retries."""
        if not self.media_id:
            attachment = self._liwan_file()
            self.media_id = whatsapp.upload_media(credentials, attachment.name, attachment.mimetype, attachment.raw)
        return self.media_id

    def _liwan_template_header(self, credentials):
        """The header parameter of a template reply as the adapter takes it, or None for a template without header values."""
        if self.template_header == 'text':
            return {'type': 'text', 'text': self.template_header_param}
        if self.template_header == 'location':
            return {'type': 'location', 'location': {
                'latitude': self.latitude, 'longitude': self.longitude,
                'name': self.location_name or '', 'address': self.location_address or '',
            }}
        if self.template_header != 'none':
            return {'type': self.template_header, 'media_id': self._liwan_media_id(credentials)}
        return None

    def _liwan_template_buttons(self):
        buttons = self.template_button_ids.sorted('position')
        return [
            {'index': button.position, 'sub_type': 'copy_code' if button.kind == 'copy_code' else 'url', 'value': button.value}
            for button in buttons if button.value
        ] + [{'index': button.position, 'sub_type': 'flow', 'value': self.flow_token} for button in buttons if button.kind == 'flow']

    def _liwan_record_failure(self, error, retryable, code=None, unconfirmed=False):
        attempts = self.attempts + 1
        values = {
            'attempts': attempts, 'error': error, 'error_code': code or False, 'unconfirmed': unconfirmed,
            'send_token': False, 'send_started_at': False,
        }
        if retryable and attempts < MAX_ATTEMPTS:
            values['next_attempt_at'] = fields.Datetime.now() + relativedelta(minutes=BACKOFF_MINUTES[attempts - 1])
        else:
            values['delivery_state'] = 'failed'
        self.write(values)
        if values.get('delivery_state') == 'failed':
            self.campaign_recipient_ids._liwan_on_failed()

    # reactions and read receipts: sent from the same cron, retried with the message backoff up to MAX_ATTEMPTS

    def _liwan_send_reaction(self):
        self.ensure_one()
        try:
            credentials = self.conversation_id.channel_id._liwan_credentials()
            whatsapp.send_reaction(
                credentials, self.conversation_id.identity_id.address, self.provider_message_id, self.agent_reaction or '',
            )
        except errors.ProviderError as error:
            self._liwan_reaction_failed(error.retryable)
        except UserError:
            self._liwan_reaction_failed(retryable=False)
        else:
            self.write({'agent_reaction_pending': False, 'reaction_attempts': 0, 'reaction_next_attempt_at': False})
            self.conversation_id._liwan_notify_bus()

    def _liwan_reaction_failed(self, retryable):
        """Back off after a failed attempt; a reaction that cannot be delivered is withdrawn instead of shown as sent."""
        if self._liwan_signal_gave_up('reaction_attempts', 'reaction_next_attempt_at', retryable):
            self.write({'agent_reaction': False, 'agent_reaction_pending': False})
            self.conversation_id._liwan_notify_bus()

    def _liwan_send_read_receipt(self):
        self.ensure_one()
        conversation = self.conversation_id
        try:
            credentials = conversation.channel_id._liwan_credentials()
            if conversation.channel_id.kind == 'tiktok':
                tiktok.send_action(credentials, conversation.provider_conversation_id, 'MARK_READ')
            else:
                whatsapp.mark_read(credentials, self.provider_message_id)
        except errors.ProviderError as error:
            self._liwan_receipt_failed(error.retryable)
        except UserError:
            self._liwan_receipt_failed(retryable=False)
        else:
            self.write({'read_receipt': 'sent', 'receipt_attempts': 0, 'receipt_next_attempt_at': False})

    def _liwan_receipt_failed(self, retryable):
        if self._liwan_signal_gave_up('receipt_attempts', 'receipt_next_attempt_at', retryable):
            self.read_receipt = 'failed'

    def _liwan_signal_gave_up(self, attempts_field, next_field, retryable):
        """Count a failed attempt of a reaction or receipt and schedule the next one with the message backoff.

        Returns True when the signal is given up (not retryable, or out of attempts).
        """
        attempts = self[attempts_field] + 1
        if retryable and attempts < MAX_ATTEMPTS:
            self.write({
                attempts_field: attempts,
                next_field: fields.Datetime.now() + relativedelta(minutes=BACKOFF_MINUTES[attempts - 1]),
            })
            return False
        self.write({attempts_field: 0, next_field: False})
        return True
