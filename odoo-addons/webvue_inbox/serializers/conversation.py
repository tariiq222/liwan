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
    }


def dump_conversation_detail(conversation, can_reply, can_assign):
    return {**dump_conversation(conversation), 'can_reply': can_reply, 'can_assign': can_assign}


def dump_messages(messages):
    """Message shapes in input order; the attachments of the page are read with one search."""
    attachments = defaultdict(list)
    for attachment in messages.env['ir.attachment'].search([
        ('res_model', '=', 'webvue.inbox.message'), ('res_id', 'in', messages.ids),
    ], order='id'):
        attachments[attachment.res_id].append({
            'id': attachment.id, 'name': attachment.name,
            'mimetype': attachment.mimetype, 'size': attachment.file_size,
        })
    return [
        {
            'id': message.id,
            'direction': message.direction,
            'body': message.body,
            'author': dump_ref(message.author_id),
            'template_name': message.template_id.name or None,
            'delivery_state': message.delivery_state,
            'error': message.error or None,
            'attachments': attachments[message.id],
            'created_at': iso(message.date),
        }
        for message in messages
    ]
