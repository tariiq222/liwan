# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok inbound: every parsed item of a delivery becomes a conversation, a message or a reaction.

The parsed items come from `adapters/tiktok.py`; this module applies them inside the event transaction, in
the channel's own company, reusing the WhatsApp ingestion helpers (the open conversation, the cycle, the
satisfaction answer and the automation engine).
"""
import logging

from odoo import api, models
from odoo.exceptions import UserError

from .inbound_service import ERROR_TEXT_LENGTH, REOPENED_STATES
from odoo.addons.liwan_inbox.adapters import errors, tiktok

_logger = logging.getLogger(__name__)

# A TikTok auto message (the welcome) is sent by TikTok itself; its echo is an outbound message with no author and
# this note, so an agent can tell it apart from a reply written by a colleague.
NOTE_TIKTOK_AUTO_WELCOME = 'رد تلقائي أرسلته TikTok: رسالة الترحيب'
# A read receipt names the moment the customer read up to; an outbound message has no state past `read`.
READ_STATES = ('sent', 'delivered')


class LiwanInboxInbound(models.AbstractModel):
    """Turns the parsed items of one TikTok delivery into customer messages and reactions."""
    _inherit = 'liwan.inbox.inbound'

    @api.model
    def _liwan_ingest_tiktok(self, channel, items, historical=False):
        """Apply `items`; returns the conversations that changed."""
        changed = self.env['liwan.inbox.conversation']
        for item in items:
            if isinstance(item, tiktok.InboundMessage):
                if item.echo:
                    changed |= self._liwan_ingest_tiktok_echo(channel, item)
                else:
                    changed |= self._liwan_ingest_tiktok_message(channel, item, historical)
            elif isinstance(item, tiktok.Reaction):
                changed |= self._liwan_ingest_reaction(channel, item)
            elif isinstance(item, tiktok.ReadUpTo):
                changed |= self._liwan_ingest_tiktok_read(channel, item)
            elif isinstance(item, tiktok.Referral):
                changed |= self._liwan_ingest_tiktok_referral(channel, item)
            elif isinstance(item, tiktok.AutoMessageChanged):
                channel._liwan_tiktok_refresh_audit()
            elif isinstance(item, tiktok.EuNotice):
                # TikTok sends no content for a sender in the EEA, Switzerland or the UK (D8); the history import
                # fetches it, so this notice is only a dispatch point today (E6.2).
                continue
        return changed

    @api.model
    def _liwan_ingest_tiktok_message(self, channel, item, historical=False):
        """Store one customer message; a message id that is already stored is the same delivery."""
        Message = self.env['liwan.inbox.message']
        if Message.search_count([('provider_message_id', '=', item.provider_id)]):
            return self.env['liwan.inbox.conversation']
        conversation = self._liwan_conversation(channel, self._liwan_tiktok_identity(channel, item))
        self._liwan_tiktok_attach_conversation(conversation, item.conversation_id)
        message = Message.create({
            'conversation_id': conversation.id, 'company_id': channel.owner_company_id.id, 'direction': 'in',
            'kind': item.kind, 'body': item.body or f'[{item.kind}]', 'date': item.sent_at,
            'delivery_state': 'received', 'provider_message_id': item.provider_id,
            **self._liwan_tiktok_reply_values(conversation, item),
        })
        if item.media_id:
            self._liwan_tiktok_attach_media(channel, message, item)
        message._liwan_on_ingested()
        if historical:
            return conversation  # imported history never reopens, alerts or answers (D11)
        automation = self.env['liwan.inbox.automation']
        if automation._liwan_record_csat(conversation, message):
            return conversation  # a survey answer neither reopens the conversation nor triggers the rules
        self.env['liwan.inbox.conversation.cycle']._liwan_open_for(conversation, message.date)
        conversation.write({
            'unread': True,
            **({'state': 'open'} if conversation.state in REOPENED_STATES else {}),
        })
        automation._liwan_run(conversation, message)
        return conversation

    @api.model
    def _liwan_tiktok_identity(self, channel, item):
        """The customer behind the sender open id; a TikTok contact has a name and no phone."""
        Identity = self.env['liwan.inbox.contact.identity']
        domain = [
            ('company_id', '=', channel.owner_company_id.id), ('channel_kind', '=', 'tiktok'),
            ('address', '=', item.sender_id),
        ]
        identity = Identity.search(domain, limit=1)
        if identity:
            return identity
        contact = self.env['liwan.inbox.contact'].create({
            'company_id': channel.owner_company_id.id, 'name': item.sender_name or item.sender_id,
        })
        return Identity.create({
            'company_id': channel.owner_company_id.id, 'contact_id': contact.id,
            'channel_kind': 'tiktok', 'address': item.sender_id,
        })

    @api.model
    def _liwan_tiktok_attach_conversation(self, conversation, provider_conversation_id):
        """Store the conversation's TikTok id; its first message also learns whether images can be sent."""
        if not conversation.provider_conversation_id:
            conversation.write({
                'provider_conversation_id': provider_conversation_id,
                'image_send_capable': self._liwan_tiktok_image_send_capable(conversation, provider_conversation_id),
            })
        elif conversation.provider_conversation_id != provider_conversation_id:
            conversation.provider_conversation_id = provider_conversation_id

    @api.model
    def _liwan_tiktok_reply_values(self, conversation, item):
        """The message this one answers and the reply button the customer tapped."""
        values = {}
        if item.context_id:
            target = self.env['liwan.inbox.message'].search([
                ('provider_message_id', '=', item.context_id), ('conversation_id', '=', conversation.id),
            ], limit=1)
            values['reply_to_id'] = target.id
        if item.option_id:
            option = self.env['liwan.inbox.message.option'].search([
                ('option_id', '=', item.option_id), ('message_id.conversation_id', '=', conversation.id),
            ], limit=1)
            values.update({'selected_option_id': item.option_id, 'selected_option_title': option.title})
        return values

    @api.model
    def _liwan_tiktok_attach_media(self, channel, message, item):
        """Store the media of an inbound message; a failure is recorded on the message, never fails the event."""
        try:
            with self.env.cr.savepoint():
                media = tiktok.fetch_media(
                    channel._liwan_credentials(), message.conversation_id.provider_conversation_id,
                    item.provider_id, item.media_id, item.media_type,
                )
                self.env['ir.attachment'].create({
                    'name': item.kind, 'raw': media.content, 'mimetype': media.mimetype,
                    'type': 'binary', 'res_model': message._name, 'res_id': message.id,
                })
        except (errors.ProviderError, UserError) as error:
            message.error = str(error)[:ERROR_TEXT_LENGTH]

    @api.model
    def _liwan_ingest_tiktok_echo(self, channel, item):
        """Store a message the business account sent elsewhere; one that LiwanOS already stored is the same send.

        The outbox stores its own message before TikTok echoes it, so a matching provider id is dropped (D6);
        an echo that matches nothing was sent from the TikTok app or by a TikTok auto message and is stored as an
        outbound message without an author.
        """
        Message = self.env['liwan.inbox.message']
        if Message.search_count([('provider_message_id', '=', item.provider_id)]):
            return self.env['liwan.inbox.conversation']
        conversation = self._liwan_tiktok_conversation(channel, item.conversation_id)
        if not conversation:
            return self.env['liwan.inbox.conversation']
        Message.create({
            'conversation_id': conversation.id, 'company_id': channel.owner_company_id.id, 'direction': 'out',
            'kind': item.kind, 'body': item.body or f'[{item.kind}]', 'date': item.sent_at,
            'delivery_state': 'sent', 'provider_message_id': item.provider_id,
        })
        if item.auto:
            Message._liwan_post_system_note(conversation, NOTE_TIKTOK_AUTO_WELCOME)
        return conversation

    @api.model
    def _liwan_ingest_tiktok_read(self, channel, item):
        """Mark every outbound message the customer has read up to as read (D7)."""
        conversation = self._liwan_tiktok_conversation(channel, item.conversation_id)
        conversation.message_ids.filtered(
            lambda message: message.direction == 'out' and message.date <= item.read_at
            and message.delivery_state in READ_STATES,
        ).write({'delivery_state': 'read'})
        return conversation

    @api.model
    def _liwan_ingest_tiktok_referral(self, channel, item):
        """Store the ad or short link the customer arrived from; a referral is not a message (D9)."""
        conversation = self._liwan_tiktok_conversation(channel, item.conversation_id)
        if conversation and item.source in ('ad', 'short_link'):
            conversation.write({'referral_source': item.source, 'referral_ref': item.ref or False})
        return conversation

    @api.model
    def _liwan_tiktok_conversation(self, channel, provider_conversation_id):
        """The conversation a TikTok event names; the open one wins over a closed thread of the same customer."""
        Conversation = self.env['liwan.inbox.conversation']
        if not provider_conversation_id:
            return Conversation
        domain = [('channel_id', '=', channel.id), ('provider_conversation_id', '=', provider_conversation_id)]
        return Conversation.search([*domain, ('state', '!=', 'closed')], limit=1) or Conversation.search(domain, limit=1)

    @api.model
    def _liwan_tiktok_image_send_capable(self, conversation, provider_conversation_id):
        """Whether this conversation can receive images; a failed check leaves the channel text-only."""
        channel = conversation.channel_id
        try:
            return tiktok.image_send_capable(channel._liwan_credentials(), provider_conversation_id)
        except (errors.ProviderError, UserError) as error:
            _logger.warning('TikTok image capability of channel %s failed: %s', channel.id, type(error).__name__)
            return False
