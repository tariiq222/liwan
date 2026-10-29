# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of conversations, messages and contacts (packages/contracts/src/inbox)."""
from collections import defaultdict

from odoo.addons.webvue_api.serializers.common import iso


def dump_ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_contact(contact):
    return {
        'id': contact.id, 'name': contact.name, 'phone': contact.phone or None, 'email': contact.email or None,
    }


def dump_conversation(conversation):
    return {
        'id': conversation.id,
        'contact': dump_contact(conversation.contact_id),
        'channel': {
            'id': conversation.channel_id.id, 'name': conversation.channel_id.name,
            'kind': conversation.channel_id.kind,
        },
        'department': dump_ref(conversation.department_id),
        'assignee': dump_ref(conversation.assignee_id),
        'state': conversation.state,
        'priority': conversation.priority,
        'tags': [dump_ref(tag) for tag in conversation.tag_ids],
        'last_message_at': iso(conversation.last_message_at),
        'last_message_preview': conversation.last_message_preview or None,
        'unread': conversation.unread,
        'reply_window_ends_at': iso(conversation.reply_window_ends_at),
        'csat': {'score': conversation.csat_score, 'at': iso(conversation.csat_at)} if conversation.csat_score else None,
    }


def dump_conversation_detail(conversation, can_reply, can_assign):
    return {**dump_conversation(conversation), 'can_reply': can_reply, 'can_assign': can_assign}


def dump_attachment(attachment):
    return {'id': attachment.id, 'name': attachment.name, 'mimetype': attachment.mimetype, 'size': attachment.file_size}


def dump_message_template(message):
    """A sent template as the thread shows it: the name and the parts around the rendered body."""
    buttons = [
        {'type': 'copy_code' if button.kind == 'otp' else button.kind,
         'text': (button.value if button.kind == 'copy_code' else button.text) or ''}
        for button in message.template_button_ids.sorted('position')
    ]
    return {
        'name': message.template_name,
        'header_text': message.template_header_text or None,
        'footer': message.template_footer or None,
        'buttons': buttons,
    }


def dump_messages(messages):
    """Message shapes in input order; the attachments of the page are read with one search."""
    attachments = defaultdict(list)
    for attachment in messages.env['ir.attachment'].search([
        ('res_model', '=', 'webvue.inbox.message'), ('res_id', 'in', messages.ids),
    ], order='id'):
        attachments[attachment.res_id].append(dump_attachment(attachment))
    return [dump_message(message, attachments[message.id]) for message in messages]


def dump_message(message, attachments):
    return {
        'id': message.id,
        'direction': message.direction,
        'kind': message.kind,
        'body': message.body,
        'author': dump_ref(message.author_id),
        'automated': message.automated,
        'template': dump_message_template(message) if message.template_name else None,
        'delivery_state': message.delivery_state,
        'error': message.error or None,
        'attachments': attachments,
        'reply_to': {'id': message.reply_to_id.id, 'preview': message.reply_to_id._webvue_reply_preview()}
        if message.reply_to_id else None,
        'reactions': {'customer': message.customer_reaction or None, 'agent': message.agent_reaction or None},
        'location': message._webvue_location() if message.kind == 'location' else None,
        'interactive': message._webvue_interactive() if message.interactive_type else None,
        'selected_option': {'id': message.selected_option_id, 'title': message.selected_option_title or ''}
        if message.selected_option_id else None,
        'created_at': iso(message.date),
    }
