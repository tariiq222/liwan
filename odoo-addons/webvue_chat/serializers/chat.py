# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso

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
