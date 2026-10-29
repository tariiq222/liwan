# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .batch import process_each
from .constants import BACKOFF_MINUTES, MAX_ATTEMPTS, OUTBOX_BATCH, TYPING_MAX_AGE
from odoo.addons.webvue_inbox.adapters import whatsapp

_logger = logging.getLogger(__name__)


class WebVueInboxMessageOutbox(models.Model):
    """The outbox cron: queued replies, then the reactions and read receipts waiting to be sent."""
    _inherit = 'webvue.inbox.message'

    @api.model
    def _webvue_run_outbox(self):
        due = self.search([
            ('direction', '=', 'out'), ('delivery_state', '=', 'queued'),
            ('next_attempt_at', '<=', fields.Datetime.now()),
        ], order='next_attempt_at, id', limit=OUTBOX_BATCH)
        process_each(due, lambda message: message._webvue_deliver(), self._webvue_unexpected_failure)
        now = fields.Datetime.now()
        reactions = self.search([
            ('agent_reaction_pending', '=', True), '|', ('reaction_next_attempt_at', '=', False), ('reaction_next_attempt_at', '<=', now),
        ], limit=OUTBOX_BATCH)
        process_each(
            reactions, lambda message: message._webvue_send_reaction(),
            lambda message, _error: message._webvue_reaction_failed(retryable=True),
        )
        receipts = self.search([
            ('read_receipt', '=', 'pending'), '|', ('receipt_next_attempt_at', '=', False), ('receipt_next_attempt_at', '<=', now),
        ], limit=OUTBOX_BATCH)
        process_each(
            receipts, lambda message: message._webvue_send_read_receipt(),
            lambda message, _error: message._webvue_receipt_failed(retryable=True),
        )
        self._webvue_run_typing()

    @api.model
    def _webvue_run_typing(self):
        """Show the typing indicator of every pending request; one older than TYPING_MAX_AGE is dropped unsent."""
        Conversation = self.env['webvue.inbox.conversation']
        pending = Conversation.search([('typing_pending', '=', True)], limit=OUTBOX_BATCH)
        process_each(
            pending, self._webvue_send_typing, lambda conversation, _error: conversation.write({'typing_pending': False}),
        )

    @api.model
    def _webvue_send_typing(self, conversation):
        """The typing indicator (which also marks the newest inbound message read); a failure is only logged."""
        conversation.typing_pending = False
        inbound = conversation._webvue_latest_inbound()
        if (not inbound or fields.Datetime.now() - conversation.typing_requested_at > TYPING_MAX_AGE
                or conversation._webvue_replied_since(conversation.typing_requested_at)):
            return
        try:
            whatsapp.mark_read(conversation.channel_id._webvue_credentials(), inbound.provider_message_id, typing=True)
        except (whatsapp.ProviderError, UserError) as error:
            _logger.warning('typing indicator of conversation %s failed: %s', conversation.id, type(error).__name__)
        else:
            inbound.write({'read_receipt': 'sent', 'receipt_attempts': 0})

    @api.model
    def _webvue_unexpected_failure(self, message, error):
        """An error outside the provider contract: counted as one retryable attempt."""
        message._webvue_record_failure(f'unexpected error: {type(error).__name__}', retryable=True)

    def _webvue_deliver(self):
        self._webvue_send()
        self.conversation_id._webvue_notify_bus()

    def _webvue_send(self):
        self.ensure_one()
        conversation = self.conversation_id
        if conversation.channel_id.state == 'disabled':
            self._webvue_record_failure(self.env._('The channel is disabled.'), retryable=False)
            return
        try:
            provider_id = self._webvue_provider_send()
        except whatsapp.ProviderError as error:
            self._webvue_record_failure(str(error), error.retryable)
        except UserError as error:
            self._webvue_record_failure(str(error), retryable=False)
        else:
            self.write({
                'delivery_state': 'sent', 'provider_message_id': provider_id,
                'attempts': self.attempts + 1, 'error': False,
            })

    def _webvue_provider_send(self):
        """Send this message and return the provider message id."""
        conversation = self.conversation_id
        credentials = conversation.channel_id._webvue_credentials()
        to = conversation.identity_id.address
        context_id = self.reply_to_id.provider_message_id or None
        if self.template_name:
            if not self.template_id:
                raise UserError(self.env._('The template was removed by the provider.'))
            return whatsapp.send_template(
                credentials, to, self.template_name, self.template_language, self.template_params or [],
                header=self._webvue_template_header(credentials), buttons=self._webvue_template_buttons(),
            )
        if self.kind == 'location':
            location = whatsapp.Location(self.latitude, self.longitude, self.location_name or None, self.location_address or None)
            return whatsapp.send_location(credentials, to, location, context_id)
        if self.kind == 'interactive':
            flow = {'flow_id': self.flow_id.provider_flow_id, 'token': self.flow_token} if self.interactive_type == 'flow' else None
            return whatsapp.send_interactive(credentials, to, self._webvue_interactive(), context_id, flow=flow)
        if self.kind in whatsapp.MEDIA_KINDS:
            return self._webvue_send_media(credentials, to, context_id)
        return whatsapp.send_text(credentials, to, self.body, context_id)

    def _webvue_send_media(self, credentials, to, context_id):
        media_id = self._webvue_media_id(credentials)
        attachment = self._webvue_file()
        return whatsapp.send_media(
            credentials, to, self.kind, media_id, self._webvue_caption(), attachment.name, context_id,
        )

    def _webvue_file(self):
        attachment = self.env['ir.attachment'].search([('res_model', '=', self._name), ('res_id', '=', self.id)], limit=1)
        if not attachment:
            raise UserError(self.env._('The file of this message is missing.'))
        return attachment

    def _webvue_media_id(self, credentials):
        """The WhatsApp media id of this message's file; it is uploaded once and kept for retries."""
        if not self.media_id:
            attachment = self._webvue_file()
            self.media_id = whatsapp.upload_media(credentials, attachment.name, attachment.mimetype, attachment.raw)
        return self.media_id

    def _webvue_template_header(self, credentials):
        """The header parameter of a template reply as the adapter takes it, or None for a template without header values."""
        if self.template_header == 'text':
            return {'type': 'text', 'text': self.template_header_param}
        if self.template_header == 'location':
            return {'type': 'location', 'location': {
                'latitude': self.latitude, 'longitude': self.longitude,
                'name': self.location_name or '', 'address': self.location_address or '',
            }}
        if self.template_header != 'none':
            return {'type': self.template_header, 'media_id': self._webvue_media_id(credentials)}
        return None

    def _webvue_template_buttons(self):
        buttons = self.template_button_ids.sorted('position')
        return [
            {'index': button.position, 'sub_type': 'copy_code' if button.kind == 'copy_code' else 'url', 'value': button.value}
            for button in buttons if button.value
        ] + [{'index': button.position, 'sub_type': 'flow', 'value': self.flow_token} for button in buttons if button.kind == 'flow']

    def _webvue_record_failure(self, error, retryable):
        attempts = self.attempts + 1
        values = {'attempts': attempts, 'error': error}
        if retryable and attempts < MAX_ATTEMPTS:
            values['next_attempt_at'] = fields.Datetime.now() + relativedelta(minutes=BACKOFF_MINUTES[attempts - 1])
        else:
            values['delivery_state'] = 'failed'
        self.write(values)

    # reactions and read receipts: sent from the same cron, retried with the message backoff up to MAX_ATTEMPTS

    def _webvue_send_reaction(self):
        self.ensure_one()
        try:
            credentials = self.conversation_id.channel_id._webvue_credentials()
            whatsapp.send_reaction(
                credentials, self.conversation_id.identity_id.address, self.provider_message_id, self.agent_reaction or '',
            )
        except whatsapp.ProviderError as error:
            self._webvue_reaction_failed(error.retryable)
        except UserError:
            self._webvue_reaction_failed(retryable=False)
        else:
            self.write({'agent_reaction_pending': False, 'reaction_attempts': 0, 'reaction_next_attempt_at': False})
            self.conversation_id._webvue_notify_bus()

    def _webvue_reaction_failed(self, retryable):
        """Back off after a failed attempt; a reaction that cannot be delivered is withdrawn instead of shown as sent."""
        if self._webvue_signal_gave_up('reaction_attempts', 'reaction_next_attempt_at', retryable):
            self.write({'agent_reaction': False, 'agent_reaction_pending': False})
            self.conversation_id._webvue_notify_bus()

    def _webvue_send_read_receipt(self):
        self.ensure_one()
        try:
            credentials = self.conversation_id.channel_id._webvue_credentials()
            whatsapp.mark_read(credentials, self.provider_message_id)
        except whatsapp.ProviderError as error:
            self._webvue_receipt_failed(error.retryable)
        except UserError:
            self._webvue_receipt_failed(retryable=False)
        else:
            self.write({'read_receipt': 'sent', 'receipt_attempts': 0, 'receipt_next_attempt_at': False})

    def _webvue_receipt_failed(self, retryable):
        if self._webvue_signal_gave_up('receipt_attempts', 'receipt_next_attempt_at', retryable):
            self.read_receipt = 'failed'

    def _webvue_signal_gave_up(self, attempts_field, next_field, retryable):
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
