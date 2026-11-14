# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
from odoo.exceptions import AccessError

from .access_service import ASSIGN, CAMPAIGNS, READ, REPLY
from odoo.addons.liwan_customers.models.privacy_hooks import (
    ACTION_ERASE,
    ACTION_RETAIN,
    refuse_incomplete,
)

OWNER = 'liwan_inbox'
ERASED_CONTACT = 'Erased contact %d'
ERASED_ADDRESS = 'erased-%d'
ERASED_MESSAGE = '[erased]'
CONTACT_KEY = 'inbox_contacts'
CONVERSATION_KEY = 'inbox_conversations'
MESSAGE_KEY = 'inbox_messages'
ATTACHMENT_KEY = 'inbox_attachments'
ANSWER_KEY = 'inbox_form_answers'
CONSENT_KEY = 'inbox_consent'
RECIPIENT_KEY = 'inbox_campaign_recipients'
# What the erase and the export of a person need besides read: reply (messages are written), campaigns (the provider
# identity, recipients and segment tags are written) and assign, which lifts the visibility policy of the company, so
# that no conversation of the person is hidden from the caller by a policy the ORM does not enforce.
REACH_CAPABILITIES = (READ, REPLY, ASSIGN, CAMPAIGNS)
# What a message keeps of the conversation after an erase is its direction, kind, date, delivery state and provider id
# (the id stops a redelivery from recreating it); everything a person wrote or was sent, or that identifies them, goes.
MESSAGE_TEXT_FIELDS = (
    'template_header_param', 'template_header_text', 'template_footer', 'interactive_header', 'interactive_footer',
    'interactive_button', 'cta_display_text', 'cta_url', 'selected_option_title', 'location_name', 'location_address',
    'error',
)
MESSAGE_CLEARED_VALUES = {
    **{name: False for name in MESSAGE_TEXT_FIELDS}, 'template_params': False, 'latitude': 0.0, 'longitude': 0.0,
    'customer_reaction': False, 'agent_reaction': False, 'agent_reaction_pending': False, 'read_receipt': False,
    'next_attempt_at': False,
}


def contact_domain(partners):
    return [('partner_id', 'in', partners.ids)]


def conversation_domain(partners):
    return [('contact_id.partner_id', 'in', partners.ids)]


def message_domain(partners):
    return [('conversation_id.contact_id.partner_id', 'in', partners.ids)]


def answer_domain(partners):
    return [('submission_id.conversation_id.contact_id.partner_id', 'in', partners.ids)]


def consent_domain(partners):
    return [('contact_id.partner_id', 'in', partners.ids)]


def recipient_domain(partners):
    return [('contact_id.partner_id', 'in', partners.ids)]


class LiwanInboxPrivacyHooks(models.AbstractModel):
    """What Customer Messages holds about a customer: the contacts linked to it and everything under them.

    An erase replaces the contact's name with a marker and clears its phone, email, segment tags and provider addresses
    (the identity address becomes a marker too, so the same person writing again is a new contact and the erased one is
    never restored). The text and files of its messages go; the conversations, message dates, directions, delivery
    states and the consent decisions stay, and its open conversations are closed because nothing can be sent to a
    cleared address. It runs as the caller and needs the inbox manager's reach (``REACH_CAPABILITIES``).
    """
    _inherit = 'liwan.customers.privacy.hooks'

    @api.model
    def _liwan_subject_coverage(self):
        return {
            **super()._liwan_subject_coverage(),
            CONTACT_KEY: ('liwan.inbox.contact', contact_domain),
            CONVERSATION_KEY: ('liwan.inbox.conversation', conversation_domain),
            MESSAGE_KEY: ('liwan.inbox.message', message_domain),
            ATTACHMENT_KEY: ('ir.attachment', self._liwan_inbox_attachment_domain),
            ANSWER_KEY: ('liwan.inbox.flow.answer', answer_domain),
            CONSENT_KEY: ('liwan.inbox.contact.consent', consent_domain),
            RECIPIENT_KEY: ('liwan.inbox.campaign.recipient', recipient_domain),
        }

    @api.model
    def _liwan_subject_not_covered(self):
        # Raw webhook deliveries name the sender and hold the text; they are deleted when processed, after the replay window.
        return [*super()._liwan_subject_not_covered(), 'inbox_provider_events']

    @api.model
    def _liwan_inbox_search(self, model_name, domain):
        """The records of ``model_name`` the domain finds as the caller (archived included); none without an ACL."""
        try:
            return self.env[model_name].with_context(active_test=False).search(domain)
        except AccessError:
            return self.env[model_name]

    @api.model
    def _liwan_inbox_attachment_domain(self, partners):
        messages = self._liwan_inbox_search('liwan.inbox.message', message_domain(partners))
        conversations = self._liwan_inbox_search('liwan.inbox.conversation', conversation_domain(partners))
        return [
            '|', '&', ('res_model', '=', 'liwan.inbox.message'), ('res_id', 'in', messages.ids),
            '&', ('res_model', '=', 'liwan.inbox.conversation'), ('res_id', 'in', conversations.ids),
            '|', ('res_field', '=', False), ('res_field', '!=', False),
        ]

    @api.model
    def _liwan_inbox_subject(self, partners):
        """``{key: records}`` of what the caller reaches, archived included."""
        search = self._liwan_inbox_search
        return {
            CONTACT_KEY: search('liwan.inbox.contact', contact_domain(partners)),
            CONVERSATION_KEY: search('liwan.inbox.conversation', conversation_domain(partners)),
            MESSAGE_KEY: search('liwan.inbox.message', message_domain(partners)),
            ATTACHMENT_KEY: search('ir.attachment', self._liwan_inbox_attachment_domain(partners)),
            ANSWER_KEY: search('liwan.inbox.flow.answer', answer_domain(partners)),
            CONSENT_KEY: search('liwan.inbox.contact.consent', consent_domain(partners)),
            RECIPIENT_KEY: search('liwan.inbox.campaign.recipient', recipient_domain(partners)),
        }

    @api.model
    def _liwan_inbox_require_reach(self, partners):
        """Refuse (409 ``erase_incomplete``) when the caller sees records of the person but lacks the full reach.

        Without ``inbox.conversations.read`` no ACL exists and the service already counts the difference; a caller with
        some rights has ACLs and record rules that agree with each other, but the visibility policy and the write
        rights are decided by capabilities, so they are checked here, before anything is written.
        """
        service = self.env['liwan.access.service']
        if all(service._liwan_has_capability(self.env.user, key) for key in REACH_CAPABILITIES):
            return
        subject = self._liwan_inbox_subject(partners)
        incomplete = [
            {'key': key, 'owner': OWNER, 'reason': 'caller_cannot_reach_all_records'}
            for key in (CONTACT_KEY, CONVERSATION_KEY, MESSAGE_KEY) if subject[key]
        ]
        if incomplete:
            refuse_incomplete(incomplete)

    @api.model
    def _liwan_subject_export(self, partners):
        self._liwan_inbox_require_reach(partners)
        subject = self._liwan_inbox_subject(partners)
        messages = subject[MESSAGE_KEY].sorted(lambda message: (message.date, message.id))
        return [
            *super()._liwan_subject_export(partners),
            {
                'key': CONTACT_KEY, 'title': 'Messaging contacts',
                'header': ['id', 'customer_id', 'name', 'phone', 'email', 'marketing_consent', 'addresses'],
                'rows': [
                    [contact.id, contact.partner_id.id, contact.name, contact.phone, contact.email,
                     contact.marketing_consent,
                     ', '.join(f'{identity.channel_kind}:{identity.address}' for identity in contact.identity_ids)]
                    for contact in subject[CONTACT_KEY]
                ],
            },
            {
                'key': MESSAGE_KEY, 'title': 'Messages',
                'header': ['id', 'conversation_id', 'contact_id', 'date', 'direction', 'kind', 'text', 'delivery_state'],
                'rows': [
                    [message.id, message.conversation_id.id, message.conversation_id.contact_id.id, message.date,
                     message.direction, message.kind, message.body, message.delivery_state]
                    for message in messages
                ],
            },
        ]

    @api.model
    def _liwan_subject_erase_preview(self, partners):
        subject = self._liwan_inbox_subject(partners)
        actions = {
            CONTACT_KEY: ACTION_ERASE, CONVERSATION_KEY: ACTION_RETAIN, MESSAGE_KEY: ACTION_ERASE,
            ATTACHMENT_KEY: ACTION_ERASE, ANSWER_KEY: ACTION_ERASE, CONSENT_KEY: ACTION_RETAIN,
            RECIPIENT_KEY: ACTION_ERASE,
        }
        return [
            *super()._liwan_subject_erase_preview(partners),
            *({'key': key, 'owner': OWNER, 'action': action, 'count': len(subject[key])} for key, action in actions.items()),
        ]

    @api.model
    def _liwan_subject_erase(self, partners):
        # Before the writes of any other hook: a refusal leaves nothing changed.
        self._liwan_inbox_require_reach(partners)
        counts = super()._liwan_subject_erase(partners)
        subject = self._liwan_inbox_subject(partners)
        subject[ATTACHMENT_KEY].unlink()
        self._liwan_inbox_erase_answers(subject[ANSWER_KEY])
        self._liwan_inbox_erase_messages(subject[MESSAGE_KEY])
        self._liwan_inbox_close_conversations(subject[CONVERSATION_KEY])
        subject[RECIPIENT_KEY].write({'address': False})
        self._liwan_inbox_erase_contacts(subject[CONTACT_KEY])
        return {**counts, **{key: len(records) for key, records in subject.items()}}

    @api.model
    def _liwan_inbox_erase_answers(self, answers):
        answers.choice_ids.unlink()
        answers.write({'value_text': False, 'value_date': False, 'value_boolean': False})

    @api.model
    def _liwan_inbox_erase_messages(self, messages):
        """Blank the text and the personal values of the messages; a message still queued is failed, never sent.

        The template buttons (a copy-code value) and the interactive options (titles, descriptions) are deleted with
        them: the thread shows both, and they hold what the agent wrote or the customer chose.
        """
        queued = messages.filtered(lambda message: message.delivery_state == 'queued')
        queued.write({'delivery_state': 'failed'})
        messages.write({'body': ERASED_MESSAGE, **MESSAGE_CLEARED_VALUES})
        messages.template_button_ids.unlink()
        messages.option_ids.unlink()

    @api.model
    def _liwan_inbox_close_conversations(self, conversations):
        """Close the open conversations: nothing can be sent to an erased address, and a new message opens a new one."""
        open_conversations = conversations.filtered(lambda conversation: conversation.state != 'closed')
        if open_conversations:
            self.env['liwan.inbox.conversation.cycle']._liwan_end_for(open_conversations, 'closed')
            open_conversations.write({'state': 'closed', 'unread': False, 'typing_pending': False})
        conversations.write({'provider_conversation_id': False})

    @api.model
    def _liwan_inbox_erase_contacts(self, contacts):
        for contact in contacts:
            for identity in contact.identity_ids:
                identity.address = ERASED_ADDRESS % identity.id
            contact.write({
                'name': ERASED_CONTACT % contact.id, 'phone': False, 'email': False, 'tag_ids': [Command.clear()],
                'last_activity_at': fields.Datetime.now(),
            })
