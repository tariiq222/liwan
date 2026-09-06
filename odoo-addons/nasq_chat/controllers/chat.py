# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
)
from odoo.addons.nasq_chat.models.chat_service import MAX_LIMIT
from odoo.addons.nasq_chat.serializers.chat import (
    dump_attachment,
    dump_conversation,
    dump_member,
    dump_message,
    dump_user_ref,
    parse_chat_attachment,
)

CREATE_FIELDS = frozenset({'user_ids', 'name'})
SEND_FIELDS = frozenset({'body', 'attachment'})
READ_FIELDS = frozenset({'message_id'})


class ChatController(http.Controller):

    def _service(self):
        return request.env['nasq.chat.service']

    def _page(self, args):
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        return limit, offset

    @http.route('/api/v1/chat/conversations', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_conversations(self, **_):
        args = request.httprequest.args
        list_filter = args.get('filter', 'all') or 'all'
        q = args.get('q') or None
        limit, offset = self._page(args)
        channels = self._service()._nasq_list_channels(q=q, list_filter=list_filter)
        total = len(channels)
        page = channels[offset:offset + limit]
        comments = self._service()._nasq_last_comments(page)
        return {
            'items': [dump_conversation(channel, comments) for channel in page],
            'total': total,
        }

    @http.route('/api/v1/chat/recipients', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_recipients(self, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        users, total = self._service()._nasq_search_recipients(
            q=args.get('q') or None, limit=limit, offset=offset,
        )
        return {
            'items': [dump_user_ref(user) for user in users],
            'total': total,
        }

    @http.route('/api/v1/chat/conversations', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_conversation(self, **payload):
        extra = set(payload) - CREATE_FIELDS
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
        channel = self._service()._nasq_create_channel(
            payload.get('user_ids'),
            name=payload.get('name'),
        )
        return request.make_json_response(dump_conversation(channel), status=201)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def get_conversation(self, conversation_id, **_):
        channel = self._service()._nasq_member_channel(conversation_id)
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/messages',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def list_messages(self, conversation_id, **_):
        args = request.httprequest.args
        limit, _offset = self._page(args)
        channel = self._service()._nasq_member_channel(conversation_id)
        messages, total = self._service()._nasq_channel_messages(
            channel,
            before=args.get('before'),
            after=args.get('after'),
            limit=limit,
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
    def send_message(self, conversation_id, **payload):
        extra = set(payload) - SEND_FIELDS
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
        attachment_payload = payload.get('attachment')
        if attachment_payload is not None and not isinstance(attachment_payload, dict):
            raise ApiError(422, 'invalid', 'attachment must be an object', field='attachment')
        parsed = parse_chat_attachment(attachment_payload) if attachment_payload else None
        channel = self._service()._nasq_member_channel(conversation_id)
        message = self._service()._nasq_post_message(
            channel,
            body=payload.get('body'),
            attachment=parsed,
        )
        return request.make_json_response(dump_message(message), status=201)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/read',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    def mark_read(self, conversation_id, **payload):
        extra = set(payload) - READ_FIELDS
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
        channel = self._service()._nasq_member_channel(conversation_id)
        channel = self._service()._nasq_mark_read(channel, payload.get('message_id'))
        return dump_conversation(channel)

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/members',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def list_members(self, conversation_id, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        channel = self._service()._nasq_member_channel(conversation_id)
        users = self._service()._nasq_channel_members(channel)
        return {
            'items': [dump_member(user) for user in users[offset:offset + limit]],
            'total': len(users),
        }

    @http.route(
        '/api/v1/chat/conversations/<int:conversation_id>/attachments',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    def list_attachments(self, conversation_id, **_):
        args = request.httprequest.args
        limit, offset = self._page(args)
        channel = self._service()._nasq_member_channel(conversation_id)
        attachments = self._service()._nasq_channel_attachments(channel)
        return {
            'items': [dump_attachment(attachment) for attachment in attachments[offset:offset + limit]],
            'total': len(attachments),
        }
