# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError

from odoo.addons.webvue_inbox.adapters import whatsapp

ERROR_TEXT_LENGTH = 200
REOPENED_STATES = ('pending', 'resolved')


class WebVueInboxInbound(models.AbstractModel):
    """Turns the parsed events of one channel into contacts, conversations and messages.

    Runs from the events cron as the superuser; every record is created in the channel's company.
    """
    _name = 'webvue.inbox.inbound'
    _description = 'Customer Inbox inbound ingestion'
    _webvue_scope = 'global'

    @api.model
    def _webvue_ingest(self, channel, items):
        """Apply `items` (parsed messages and statuses); returns the conversations that changed."""
        changed = self.env['webvue.inbox.conversation']
        for item in items:
            if isinstance(item, whatsapp.InboundMessage):
                changed |= self._webvue_ingest_message(channel, item)
            else:
                changed |= self.env['webvue.inbox.message']._webvue_apply_status(item).conversation_id
        return changed

    @api.model
    def _webvue_ingest_message(self, channel, item):
        Message = self.env['webvue.inbox.message']
        if Message.search_count([('provider_message_id', '=', item.provider_id)]):
            return self.env['webvue.inbox.conversation']
        conversation = self._webvue_conversation(channel, self._webvue_identity(channel, item))
        message = Message.create({
            'conversation_id': conversation.id, 'company_id': channel.owner_company_id.id, 'direction': 'in',
            'body': item.body, 'date': item.sent_at, 'delivery_state': 'received',
            'provider_message_id': item.provider_id,
        })
        if item.media_id:
            self._webvue_attach_media(channel, message, item)
        conversation.write({
            'unread': True,
            **({'state': 'open'} if conversation.state in REOPENED_STATES else {}),
        })
        return conversation

    @api.model
    def _webvue_identity(self, channel, item):
        Identity = self.env['webvue.inbox.contact.identity']
        domain = [('company_id', '=', channel.owner_company_id.id), ('channel_kind', '=', channel.kind), ('address', '=', item.wa_id)]
        identity = Identity.search(domain, limit=1)
        if identity:
            return identity
        Contact = self.env['webvue.inbox.contact']
        phone = Contact._webvue_phone_from_address(item.wa_id)
        contact = Contact.create({
            'company_id': channel.owner_company_id.id, 'name': item.profile_name or phone, 'phone': phone,
        })
        return Identity.create({
            'company_id': channel.owner_company_id.id, 'contact_id': contact.id,
            'channel_kind': channel.kind, 'address': item.wa_id,
        })

    @api.model
    def _webvue_conversation(self, channel, identity):
        Conversation = self.env['webvue.inbox.conversation']
        conversation = Conversation.search([
            ('channel_id', '=', channel.id), ('identity_id', '=', identity.id), ('state', '!=', 'closed'),
        ], limit=1)
        return conversation or Conversation.create({
            'company_id': channel.owner_company_id.id, 'channel_id': channel.id, 'contact_id': identity.contact_id.id,
            'identity_id': identity.id, 'department_id': channel.department_id.id,
        })

    @api.model
    def _webvue_attach_media(self, channel, message, item):
        """Store the media of an inbound message; a failure is recorded on the message, never fails the event."""
        try:
            with self.env.cr.savepoint():
                media = whatsapp.fetch_media(channel._webvue_credentials(), item.media_id)
                self.env['ir.attachment'].create({
                    'name': item.filename or item.kind, 'raw': media.content, 'mimetype': media.mimetype,
                    'type': 'binary', 'res_model': message._name, 'res_id': message.id,
                })
        except (whatsapp.ProviderError, UserError) as error:
            message.error = str(error)[:ERROR_TEXT_LENGTH]
