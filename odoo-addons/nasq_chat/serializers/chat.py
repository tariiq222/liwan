# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo import fields
from odoo.tools import html2plaintext
from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_api.serializers.common import iso

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ENCODED_CHARS = 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3)
ALLOWED_MIMETYPES = frozenset({
    'text/plain',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})
GENERIC_MIMETYPE = 'application/octet-stream'
UPLOAD_FIELDS = frozenset({'name', 'mimetype', 'data'})
CONVERSATION_KEYS = (
    'id', 'type', 'name', 'unread_count', 'last_message_at',
    'last_message_preview', 'member_count', 'muted', 'notifications',
    'peer_seen_message_id', 'im_status', 'can_manage',
)
MESSAGE_KEYS = (
    'id', 'conversation_id', 'author', 'body', 'created_at', 'attachments',
    'parent', 'edited', 'pinned', 'starred', 'reactions',
)
MEMBER_KEYS = ('id', 'name', 'im_status')
ATTACHMENT_KEYS = ('id', 'name', 'mimetype', 'url')
RECIPIENT_KEYS = ('id', 'name')
REACTION_CONTENTS = frozenset({'👍', '❤️', '😂', '🎉', '😮', '😢'})


def dump_user_ref(user):
    return {'id': user.id, 'name': user.name or ''}


def dump_attachment(attachment):
    return {
        'id': attachment.id,
        'name': attachment.name or '',
        'mimetype': attachment.mimetype or '',
        'url': f'/web/content/{attachment.id}?download=true',
    }


def dump_member(user):
    return {**dump_user_ref(user), 'im_status': user.im_status or None}


def _partner_user(partner):
    users = partner.user_ids.filtered(lambda user: not user.share)
    return users[:1]


def _plain_body(html):
    return html2plaintext(html or '', include_references=False).strip()


def _conversation_type(channel):
    return {'chat': 'direct', 'group': 'group', 'channel': 'channel'}[channel.channel_type]


def _conversation_name(channel, viewer):
    if channel.channel_type == 'chat':
        others = channel.channel_member_ids.partner_id - viewer.partner_id
        if others:
            return others[0].name or channel.name or ''
    return channel.name or ', '.join(channel.channel_member_ids.partner_id.mapped('name'))


def _last_comment(channel, comments_by_channel=None):
    if comments_by_channel is not None:
        return comments_by_channel.get(channel.id)
    return channel.env['mail.message'].search([
        ('model', '=', 'discuss.channel'),
        ('res_id', '=', channel.id),
        ('message_type', '=', 'comment'),
    ], order='id desc', limit=1)


def dump_conversation(channel, comments_by_channel=None):
    viewer = channel.env.user
    last = _last_comment(channel, comments_by_channel)
    member = channel.self_member_id
    unread = member.message_unread_counter if member else 0
    others = channel.channel_member_ids.filtered(
        lambda channel_member: channel_member.partner_id != viewer.partner_id,
    )
    peer = others[:1] if channel.channel_type == 'chat' else channel.env['discuss.channel.member']
    peer_partner = peer.partner_id if peer else channel.env['res.partner']
    muted = bool(
        member and member.mute_until_dt
        and fields.Datetime.now() < member.mute_until_dt,
    )
    return {
        'id': channel.id,
        'type': _conversation_type(channel),
        'name': _conversation_name(channel, viewer),
        'unread_count': unread,
        'last_message_at': iso(last.date) if last else None,
        'last_message_preview': _plain_body(last.body) if last else None,
        'member_count': channel.member_count,
        'muted': muted,
        'notifications': (member.custom_notifications or None) if member else None,
        'peer_seen_message_id': peer.seen_message_id.id if peer and peer.seen_message_id else None,
        'im_status': peer_partner.im_status or None if peer_partner else None,
        'can_manage': channel.channel_type in ('group', 'channel') and channel.has_access('write'),
    }


def _message_author_user(message):
    author_user = _partner_user(message.author_id) if message.author_id else message.env['res.users']
    return author_user[:1] if author_user else message.create_uid


def _dump_message_parent(message):
    parent = message.parent_id
    if not parent or parent.model != 'discuss.channel' or parent.res_id != message.res_id:
        return None
    author = _message_author_user(parent)
    return {
        'id': parent.id,
        'author': dump_user_ref(author),
        'body': _plain_body(parent.body),
    }


def _dump_reactions(message):
    grouped = {}
    for reaction in message.sudo().reaction_ids.sorted(key=lambda item: item.id):
        item = grouped.setdefault(reaction.content, {'content': reaction.content, 'count': 0, 'me': False})
        item['count'] += 1
        item['me'] = item['me'] or reaction.partner_id == message.env.user.partner_id
    return list(grouped.values())


def dump_message(message):
    author_user = _message_author_user(message)
    attachments = message.attachment_ids.filtered(
        lambda attachment: attachment.type == 'binary' and not attachment.url,
    )
    return {
        'id': message.id,
        'conversation_id': message.res_id,
        'author': dump_user_ref(author_user),
        'body': _plain_body(message.body),
        'created_at': iso(message.date),
        'attachments': [dump_attachment(attachment) for attachment in attachments],
        'parent': _dump_message_parent(message),
        'edited': 'o-mail-Message-edited' in (message.body or ''),
        'pinned': bool(message.pinned_at),
        'starred': bool(message.starred),
        'reactions': _dump_reactions(message),
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    name = value.strip()
    if '\x00' in name or '/' in name or '\\' in name or name in {'.', '..'}:
        raise ApiError(422, 'invalid', 'name must be a basename', field='name')
    return name


def _parse_mimetype(value):
    if value in (None, False, ''):
        return None
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'mimetype must be a string', field='mimetype')
    mimetype = value.strip().lower()
    if mimetype not in ALLOWED_MIMETYPES and mimetype != GENERIC_MIMETYPE:
        raise ApiError(422, 'invalid', 'mimetype is not allowed', field='mimetype')
    return mimetype


def parse_chat_attachment(payload):
    extra = set(payload) - UPLOAD_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    name = _parse_name(payload.get('name'))
    hinted_mimetype = _parse_mimetype(payload.get('mimetype'))
    data = payload.get('data')
    if not isinstance(data, str) or not data.strip():
        raise ApiError(422, 'invalid', 'data is required', field='data')
    if len(data) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    cleaned = ''.join(data.split())
    if len(cleaned) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', 'attachment data exceeds the encoded size limit', field='data')
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, 'invalid', 'data must be valid base64', field='data') from None
    if not raw:
        raise ApiError(422, 'invalid', 'data must contain a non-empty file', field='data')
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, 'invalid', 'attachment exceeds 10MB', field='data')
    detected = (guess_mimetype(raw) or GENERIC_MIMETYPE).lower().split(';', 1)[0].strip()
    if detected not in ALLOWED_MIMETYPES:
        raise ApiError(422, 'invalid', 'file type is not allowed', field='data')
    return {
        'name': name,
        'raw': raw,
        'mimetype': detected,
        'hinted_mimetype': hinted_mimetype,
    }
