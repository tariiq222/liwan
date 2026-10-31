# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import fields
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.serializers.attachment import dump_attachment
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_chat.models.chat_service import MEMBER_REMOVED_NOTICE

CONVERSATION_KEYS = (
    'id', 'type', 'name', 'unread_count', 'last_message_at',
    'last_message_preview', 'member_count', 'muted', 'notifications',
    'peer_seen_message_id', 'im_status', 'can_manage', 'can_remove_members',
)
MESSAGE_KEYS = (
    'id', 'conversation_id', 'author', 'body', 'created_at', 'attachments',
    'parent', 'edited', 'deleted', 'pinned', 'starred', 'reactions', 'notice',
)
MEMBER_KEYS = ('id', 'name', 'im_status')
ATTACHMENT_KEYS = ('id', 'name', 'mimetype', 'url')
RECIPIENT_KEYS = ('id', 'name')
REACTION_CONTENTS = frozenset({'👍', '❤️', '😂', '🎉', '😮', '😢'})
# Anchored on the opening tag: typed text is always escaped, so only a server-posted notice starts with it.
NOTICE_PATTERN = re.compile(rf'<div class="o_mail_notification" data-oe-type="{MEMBER_REMOVED_NOTICE}" data-oe-id="(\d+)">')


def dump_user_ref(user):
    return {'id': user.id, 'name': user.name or ''}


def conversation_attachments_route(conversation_id):
    return f'/api/v1/chat/conversations/{conversation_id}/attachments'


def dump_member(user):
    return {**dump_user_ref(user), 'im_status': user.im_status or None}


def _partner_user(partner):
    users = partner.user_ids.filtered(lambda user: not user.share)
    return users[:1]


def _plain_body(html):
    return html2plaintext(html or '', include_references=False).strip()


def message_notice(message):
    """The structured notice a conversation event left, or None for an ordinary message."""
    match = NOTICE_PATTERN.match(message.body or '')
    if not match:
        return None
    user = message.env['res.users'].with_context(active_test=False).browse(int(match.group(1))).exists()
    return {'type': 'member_removed', 'user': dump_user_ref(user)} if user else None


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
        'last_message_preview': _plain_body(last.body) if last and not message_notice(last) else None,
        'member_count': channel.member_count,
        'muted': muted,
        'notifications': (member.custom_notifications or None) if member else None,
        'peer_seen_message_id': peer.seen_message_id.id if peer and peer.seen_message_id else None,
        'im_status': peer_partner.im_status or None if peer_partner else None,
        'can_manage': channel.channel_type in ('group', 'channel') and channel.has_access('write'),
        'can_remove_members': channel.channel_type == 'group' and channel.create_uid == viewer,
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
    notice = message_notice(message)
    attachments = message.attachment_ids.filtered(
        lambda attachment: attachment.type == 'binary' and not attachment.url,
    )
    return {
        'id': message.id,
        'conversation_id': message.res_id,
        'author': dump_user_ref(author_user),
        'body': '' if notice else _plain_body(message.body),
        'created_at': iso(message.date),
        'attachments': [dump_attachment(attachment, conversation_attachments_route(message.res_id)) for attachment in attachments],
        'parent': _dump_message_parent(message),
        'edited': 'o-mail-Message-edited' in (message.body or ''),
        # A deleted message under the «placeholder» policy keeps its row with neither text nor files.
        'deleted': not notice and not _plain_body(message.body) and not attachments,
        'pinned': bool(message.pinned_at),
        'starred': bool(message.starred),
        'reactions': _dump_reactions(message),
        'notice': notice,
    }
