# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    no_content,
    reject,
    visible_conversation,
    visible_message,
)
from odoo.addons.webvue_inbox.controllers.reply_parsing import parse_reply
from odoo.addons.webvue_inbox.models.access_service import REPLY
from odoo.addons.webvue_inbox.serializers.conversation import dump_messages

MAX_EMOJI = 16


class ReplyController(http.Controller):

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/messages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def reply(self, conversation_id, **payload):
        conversation = visible_conversation(conversation_id)
        parsed = parse_reply(conversation, payload)
        Message = request.env['webvue.inbox.message']
        if parsed.template:
            message = Message._webvue_queue_template(conversation, parsed.template, parsed.params)
        else:
            message = Message._webvue_queue_free_form(conversation, parsed.values, parsed.reply_to, parsed.attachment)
        conversation._webvue_notify_bus()
        return dump_messages(message)[0]

    @http.route('/api/v1/inbox/messages/<int:message_id>/reaction', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def react(self, message_id, **payload):
        message = visible_message(message_id)
        check_fields(payload, {'emoji'}, required=('emoji',))
        emoji = payload['emoji']
        if not isinstance(emoji, str) or len(emoji) > MAX_EMOJI:
            reject(f'emoji must be a string of at most {MAX_EMOJI} characters', 'emoji')
        message._webvue_react(emoji)
        message.conversation_id._webvue_notify_bus()
        return dump_messages(message)[0]

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/typing', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def typing(self, conversation_id, **_):
        """Records the request (the outbox shows it); the answer is 204 whether or not it was recorded."""
        visible_conversation(conversation_id)._webvue_request_typing()
        return no_content()
