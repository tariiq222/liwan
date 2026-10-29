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
        """Apply `items` (parsed messages, reactions, statuses and template and form changes); returns the conversations that changed."""
        changed = self.env['webvue.inbox.conversation']
        for item in items:
            if isinstance(item, whatsapp.InboundMessage):
                changed |= self._webvue_ingest_message(channel, item)
            elif isinstance(item, whatsapp.InboundReaction):
                changed |= self._webvue_ingest_reaction(channel, item)
            elif isinstance(item, whatsapp.TEMPLATE_UPDATES):
                self.env['webvue.inbox.template']._webvue_apply_update(channel, item)
            elif isinstance(item, whatsapp.FLOW_UPDATES):
                self.env['webvue.inbox.flow']._webvue_apply_update(channel, item)
            elif isinstance(item, whatsapp.HEALTH_UPDATES):
                channel._webvue_apply_health_update(item)
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
            'provider_message_id': item.provider_id, **self._webvue_content_values(conversation, item),
        })
        if item.media_id:
            self._webvue_attach_media(channel, message, item)
        message._webvue_on_ingested()
        automation = self.env['webvue.inbox.automation']
        if automation._webvue_record_csat(conversation, message):
            return conversation  # a survey answer neither reopens the conversation nor triggers the rules
        self.env['webvue.inbox.conversation.cycle']._webvue_open_for(conversation, message.date)
        conversation.write({
            'unread': True,
            **({'state': 'open'} if conversation.state in REOPENED_STATES else {}),
        })
        if item.flow_response:
            self.env['webvue.inbox.flow.submission']._webvue_receive(channel, conversation, message, item.flow_response, item.context_id)
        automation._webvue_run(conversation, message)
        return conversation

    @api.model
    def _webvue_content_values(self, conversation, item):
        """The kind-specific fields of an inbound message: reply target, location and the chosen option."""
        values = {'kind': item.kind}
        if item.context_id:
            target = self.env['webvue.inbox.message'].search([
                ('provider_message_id', '=', item.context_id), ('conversation_id', '=', conversation.id),
            ], limit=1)
            values['reply_to_id'] = target.id
        if item.location:
            values.update({
                'latitude': item.location.latitude, 'longitude': item.location.longitude,
                'location_name': item.location.name, 'location_address': item.location.address,
            })
        if item.option:
            values.update({'selected_option_id': item.option.id, 'selected_option_title': item.option.title})
        if item.order:
            values.update({'catalog_id': item.order.catalog_id, 'order_line_ids': [(0, 0, {
                'sequence': index, 'retailer_id': line.retailer_id, 'quantity': line.quantity,
                'item_price': line.item_price, 'currency': line.currency,
            }) for index, line in enumerate(item.order.items)]})
        if item.referred_product:
            values.update({
                'referred_catalog_id': item.referred_product.catalog_id,
                'referred_retailer_id': item.referred_product.retailer_id,
            })
        return values

    @api.model
    def _webvue_ingest_reaction(self, channel, item):
        """Set (or clear) the customer's reaction on the message it names; a reaction is never a message."""
        target = self.env['webvue.inbox.message'].search([
            ('provider_message_id', '=', item.target_id), ('conversation_id.channel_id', '=', channel.id),
        ], limit=1)
        target.customer_reaction = item.emoji or False
        return target.conversation_id

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
