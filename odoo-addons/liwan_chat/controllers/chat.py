# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import http
from odoo.http import request
from odoo.tools.mail import plaintext2html

from odoo.addons.liwan_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)
from odoo.addons.liwan_chat.models.chat_service import MAX_LIMIT
from odoo.addons.liwan_chat.serializers.chat import (
    REACTION_CONTENTS,
    conversation_attachments_route,
    dump_conversation,
    dump_member,
    dump_message,
    dump_user_ref,
    message_deleted,
    message_notice,
)

MUTE_UNTIL = datetime(9999, 12, 31, 23, 59, 59)

CREATE_FIELDS = frozenset({'user_ids', 'name', 'type'})
PATCH_FIELDS = frozenset({'name', 'muted', 'notifications'})
MEMBER_FIELDS = frozenset({'user_ids'})
SEND_FIELDS = frozenset({'body', 'attachment', 'parent_id', 'mention_user_ids'})
MESSAGE_PATCH_FIELDS = frozenset({'body'})
REACTION_FIELDS = frozenset({'content', 'action'})
PIN_FIELDS = frozenset({'pinned'})
TYPING_FIELDS = frozenset({'is_typing'})
READ_FIELDS = frozenset({'message_id'})


def _reject_extra(payload, allowed):
    extra = set(payload) - allowed
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)


class ChatController(http.Controller):

    def _service(self):
        return request.env['liwan.chat.service']

    def _page(self, args):
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit') or 50, MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        return limit, offset

    @http.route('/api/v1/chat/conversations', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def list_conversations(self, **_):
        args = request.httprequest.args
        list_filter = args.get('filter', 'all') or 'all'
        q = args.get('q') or None
        limit, offset = self._page(args)
        channels = self._service()._liwan_list_channels(q=q, list_filter=list_filter)
        total = len(channels)
        page = channels[offset:offset + limit]
        comments = self._service()._liwan_last_comments(page)
        return {
            'items': [dump_conversation(channel, comments) for channel in page],
            'total': total,
        }

    @http.route('/api/v1/chat/recipients', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def list_recipients(self, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        users, total = self._service()._liwan_search_recipients(
            q=args.get('q') or None, limit=limit, offset=offset,
        )
        return {
            'items': [dump_user_ref(user) for user in users],
            'total': total,
        }

    @http.route('/api/v1/chat/conversations', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def create_conversation(self, **payload):
        _reject_extra(payload, CREATE_FIELDS)
        channel = self._service()._liwan_create_channel(
            payload.get('user_ids'),
            name=payload.get('name'),
            channel_type=payload.get('type'),
        )
        self._service()._liwan_notify_channel(channel, 'conversation_created')
        return request.make_json_response(dump_conversation(channel), status=201)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def get_conversation(self, conversation_id, **_):
        channel = self._service()._liwan_member_channel(conversation_id)
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def patch_conversation(self, conversation_id, **payload):
        _reject_extra(payload, PATCH_FIELDS)
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        member = service._liwan_self_member(channel)
        if 'name' in payload:
            if channel.channel_type == 'chat' or not channel.has_access('write'):
                raise ApiError(403, 'forbidden', 'you cannot rename this conversation')
            name = payload['name']
            if not isinstance(name, str) or not name.strip():
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
            channel.channel_rename(name.strip())
        if 'muted' in payload:
            if not isinstance(payload['muted'], bool):
                raise ApiError(422, 'invalid', 'muted must be a boolean', field='muted')
            member.mute_until_dt = MUTE_UNTIL if payload['muted'] else False
            member._notify_mute()
        if 'notifications' in payload:
            notifications = payload['notifications']
            if notifications not in (None, 'all', 'mentions', 'no_notif'):
                raise ApiError(422, 'invalid', 'notifications is invalid', field='notifications')
            member.custom_notifications = notifications
        service._liwan_notify_channel(channel, 'conversation_updated')
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def list_messages(self, conversation_id, **_):
        args = request.httprequest.args
        limit, _offset = self._page(args)
        channel = self._service()._liwan_member_channel(conversation_id)
        messages, total = self._service()._liwan_channel_messages(
            channel,
            before=args.get('before'),
            after=args.get('after'),
            limit=limit,
            q=args.get('q') or None,
            starred=args.get('starred') == '1',
        )
        return {
            'items': [dump_message(message) for message in messages],
            'total': total,
        }

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def send_message(self, conversation_id, **payload):
        _reject_extra(payload, SEND_FIELDS)
        attachment_payload = payload.get('attachment')
        if attachment_payload is not None and not isinstance(attachment_payload, dict):
            raise ApiError(422, 'invalid', 'attachment must be an object', field='attachment')
        parsed = parse_attachment_upload(attachment_payload) if attachment_payload else None
        parent_id = payload.get('parent_id')
        if parent_id is not None:
            parent_id = parse_positive_int(parent_id, 'parent_id')
        channel = self._service()._liwan_member_channel(conversation_id)
        message = self._service()._liwan_post_message(
            channel,
            body=payload.get('body'),
            attachment=parsed,
            parent_id=parent_id,
            mention_user_ids=payload.get('mention_user_ids'),
        )
        self._service()._liwan_notify_channel(channel, 'message_created')
        return request.make_json_response(dump_message(message), status=201)

    def _own_message(self, conversation_id, message_id):
        """The channel and a message of it that the caller wrote and may change; a conversation notice is nobody's."""
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        message = service._liwan_channel_message(channel, message_id)
        if message.author_id != request.env.user.partner_id:
            raise ApiError(403, 'forbidden', 'only the message author can change it')
        if message_notice(message):
            raise ApiError(422, 'invalid', 'a conversation notice cannot be changed')
        return channel, message

    @staticmethod
    def _live_message(message):
        """A cleared message stays as a row only: it cannot be edited, pinned or reacted to again."""
        if message_deleted(message):
            raise ApiError(422, 'invalid', 'the message was deleted')

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages/<int:message_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def patch_message(self, conversation_id, message_id, **payload):
        _reject_extra(payload, MESSAGE_PATCH_FIELDS)
        if 'body' not in payload or not isinstance(payload['body'], str):
            raise ApiError(422, 'invalid', 'body must be a string', field='body')
        body = payload['body']
        if not body.strip():
            raise ApiError(422, 'invalid', 'body must not be empty; delete the message instead', field='body')
        channel, message = self._own_message(conversation_id, message_id)
        self._live_message(message)
        channel._message_update_content(message, body=plaintext2html(body))
        self._service()._liwan_notify_channel(channel, 'message_updated')
        return dump_message(message)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages/<int:message_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def delete_message(self, conversation_id, message_id, **payload):
        _reject_extra(payload, frozenset())
        channel, message = self._own_message(conversation_id, message_id)
        deleted_id = message.id
        mode = self._service()._liwan_delete_message(channel, message)
        if mode == 'permanent':
            # An open history keeps the ids a refetch no longer returns, so the removed id travels with the event.
            self._service()._liwan_notify_channel(channel, 'message_deleted', extra={'message_id': deleted_id})
        else:
            self._service()._liwan_notify_channel(channel, 'message_updated')
        # A cleared message keeps its row, so the page gets it back; a removed one is gone.
        return {'mode': mode, 'message': dump_message(message) if mode == 'placeholder' else None}

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages/<int:message_id>/reactions',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def react_to_message(self, conversation_id, message_id, **payload):
        _reject_extra(payload, REACTION_FIELDS)
        content = payload.get('content')
        action = payload.get('action')
        if content not in REACTION_CONTENTS:
            raise ApiError(422, 'invalid', 'content is not an allowed reaction', field='content')
        if action not in ('add', 'remove'):
            raise ApiError(422, 'invalid', 'action must be add or remove', field='action')
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        message = service._liwan_channel_message(channel, message_id)
        self._live_message(message)
        # sudo: mail.message.reaction has no user ACL; stock /mail/message/reaction does the same
        # after the caller proved channel membership (see _liwan_member_channel above).
        message.sudo()._message_reaction(
            content, action, request.env.user.partner_id, request.env['mail.guest'],
        )
        service._liwan_notify_channel(channel, 'reaction_updated')
        return dump_message(message)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages/<int:message_id>/pin',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def pin_message(self, conversation_id, message_id, **payload):
        _reject_extra(payload, PIN_FIELDS)
        if not isinstance(payload.get('pinned'), bool):
            raise ApiError(422, 'invalid', 'pinned must be a boolean', field='pinned')
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        message = service._liwan_channel_message(channel, message_id)
        if payload['pinned']:
            self._live_message(message)
        channel.set_message_pin(message.id, payload['pinned'])
        message.invalidate_recordset(['pinned_at'])
        service._liwan_notify_channel(channel, 'pin_updated')
        return dump_message(message)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages/<int:message_id>/star',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def star_message(self, conversation_id, message_id, **payload):
        _reject_extra(payload, frozenset())
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        message = service._liwan_channel_message(channel, message_id)
        message.toggle_message_starred()
        service._liwan_notify_channel(channel, 'star_updated')
        return dump_message(message)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/read',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def mark_read(self, conversation_id, **payload):
        _reject_extra(payload, READ_FIELDS)
        channel = self._service()._liwan_member_channel(conversation_id)
        channel = self._service()._liwan_mark_read(channel, payload.get('message_id'))
        self._service()._liwan_notify_channel(channel, 'read_updated')
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/members',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def list_members(self, conversation_id, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        channel = self._service()._liwan_member_channel(conversation_id)
        users = self._service()._liwan_channel_members(channel)
        return {
            'items': [dump_member(user) for user in users[offset:offset + limit]],
            'total': len(users),
        }

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/members',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def add_members(self, conversation_id, **payload):
        _reject_extra(payload, MEMBER_FIELDS)
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        if channel.channel_type == 'chat' or not channel.has_access('write'):
            raise ApiError(403, 'forbidden', 'you cannot add members')
        partners = service._liwan_resolve_user_partners(payload.get('user_ids'), include_self=True)
        before = channel.channel_member_ids.partner_id.ids
        channel._add_members(partners=partners)
        service._liwan_notify_channel(channel, 'members_updated', before)
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/members/<int:user_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def remove_member(self, conversation_id, user_id, **payload):
        _reject_extra(payload, frozenset())
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        return dump_conversation(service._liwan_remove_member(channel, user_id))

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/leave',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def leave_conversation(self, conversation_id, **payload):
        _reject_extra(payload, frozenset())
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        if channel.channel_type == 'chat':
            raise ApiError(403, 'forbidden', 'direct chats cannot be left')
        if channel.channel_type == 'group' and channel.member_count <= 2:
            raise ApiError(422, 'invalid', 'a group must keep at least two members')
        before = channel.channel_member_ids.partner_id.ids
        channel._action_unfollow(partner=request.env.user.partner_id)
        service._liwan_notify_channel(channel, 'conversation_left', before)
        return {'left': True}

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/typing',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='write')
    def notify_typing(self, conversation_id, **payload):
        _reject_extra(payload, TYPING_FIELDS)
        if not isinstance(payload.get('is_typing'), bool):
            raise ApiError(422, 'invalid', 'is_typing must be a boolean', field='is_typing')
        service = self._service()
        channel = service._liwan_member_channel(conversation_id)
        is_typing = payload['is_typing']
        service._liwan_self_member(channel)._notify_typing(is_typing)
        service._liwan_notify_channel(channel, 'typing', extra={
            'user_id': request.env.uid,
            'user_name': request.env.user.name or '',
            'is_typing': is_typing,
        })
        return {'ok': True}

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/attachments',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def list_attachments(self, conversation_id, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        channel = self._service()._liwan_member_channel(conversation_id)
        attachments = self._service()._liwan_channel_attachments(channel)
        return {
            'items': [dump_attachment(attachment, conversation_attachments_route(channel.id)) for attachment in attachments[offset:offset + limit]],
            'total': len(attachments),
        }

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/attachments/<int:attachment_id>/download',
        type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('chat.enabled', operation='read')
    def download_attachment(self, conversation_id, attachment_id, **_):
        """A file of a message in the conversation, for a member of it."""
        channel = self._service()._liwan_member_channel(conversation_id)
        return download_linked_attachment(self._service()._liwan_channel_attachment(channel, attachment_id), attachment_id)
