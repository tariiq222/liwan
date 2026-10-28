# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io
import os

from odoo import http
from odoo.http import request
from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.webvue_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.adapters import media_rules
from odoo.addons.webvue_inbox.controllers.conversations import conversation_domain
from odoo.addons.webvue_inbox.controllers.helpers import (
    reject,
    visible_conversation,
    visible_message,
)
from odoo.addons.webvue_inbox.models.access_service import EXPORT, READ, REPLY
from odoo.addons.webvue_inbox.serializers.conversation import dump_attachment

EXPORT_LIMIT = 10000
EXPORT_HEADER = (
    'id', 'contact', 'phone', 'channel', 'department', 'assignee', 'state', 'priority', 'tags', 'last_message_at',
)
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
UPLOAD_FIELD = 'file'
MULTIPART_OVERHEAD_BYTES = 64 * 1024
MAX_FILENAME = 255


def safe_cell(value):
    """Neutralise spreadsheet formulas in customer-controlled text."""
    return f"'{value}" if value.startswith(FORMULA_PREFIXES) else value


def export_row(conversation):
    return [
        conversation.id,
        safe_cell(conversation.contact_id.name),
        conversation.contact_id.phone or '',
        safe_cell(conversation.channel_id.name),
        safe_cell(conversation.department_id.name or ''),
        safe_cell(conversation.assignee_id.name or ''),
        conversation.state,
        conversation.priority,
        safe_cell(', '.join(conversation.tag_ids.mapped('name'))),
        iso(conversation.last_message_at) or '',
    ]


def too_large():
    return ApiError(413, 'payload_too_large', 'the file is too large for WhatsApp')


def upload_name(file):
    name = os.path.basename((file.filename or '').replace('\\', '/')).strip()
    if not name or name in {'.', '..'} or '\x00' in name or len(name) > MAX_FILENAME:
        reject('the file needs a name of at most 255 characters', UPLOAD_FIELD)
    return name


def read_upload():
    """(name, bytes, mimetype) of the multipart `file` field, checked against the WhatsApp type and size rules."""
    length = request.httprequest.content_length
    if length is not None and length > media_rules.LARGEST_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES:
        raise too_large()
    file = request.httprequest.files.get(UPLOAD_FIELD)
    if file is None:
        reject('the file field is required', UPLOAD_FIELD)
    raw = file.stream.read(media_rules.LARGEST_UPLOAD_BYTES + 1)
    if len(raw) > media_rules.LARGEST_UPLOAD_BYTES:
        raise too_large()
    if not raw:
        reject('the file is empty', UPLOAD_FIELD)
    mimetype = media_rules.resolve_mimetype(file.mimetype, guess_mimetype(raw))
    if not mimetype:
        reject('this file type cannot be sent over WhatsApp', UPLOAD_FIELD)
    if len(raw) > media_rules.limit_of(media_rules.kind_of(mimetype)):
        raise too_large()
    return upload_name(file), raw, mimetype


class ConversationFilesController(http.Controller):

    @http.route('/api/v1/inbox/conversations/export.csv', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(EXPORT)
    def export_conversations(self, **_):
        domain = conversation_domain(request.httprequest.args)
        conversations = request.env['webvue.inbox.conversation']._webvue_search_visible(domain, limit=EXPORT_LIMIT)
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(EXPORT_HEADER)
        writer.writerows(export_row(conversation) for conversation in conversations)
        return request.make_response('﻿' + out.getvalue(), headers=[
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', 'attachment; filename="conversations.csv"'),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])

    @http.route(
        '/api/v1/inbox/messages/<int:message_id>/attachments/<int:attachment_id>/download',
        type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def download_attachment(self, message_id, attachment_id, **_):
        message = visible_message(message_id)
        attachments = request.env['ir.attachment'].search([
            ('res_model', '=', message._name), ('res_id', '=', message.id),
        ])
        return download_linked_attachment(attachments, attachment_id)

    @http.route(
        '/api/v1/inbox/conversations/<int:conversation_id>/uploads',
        type='http', auth='user', methods=['POST'], csrf=False, readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def upload_file(self, conversation_id, **_):
        """Store a file for a later reply; it hangs on the conversation until a reply uses it or a day passes."""
        conversation = visible_conversation(conversation_id)
        name, raw, mimetype = read_upload()
        attachment = request.env['ir.attachment'].create({
            'name': name, 'raw': raw, 'mimetype': mimetype, 'type': 'binary',
            'res_model': conversation._name, 'res_id': conversation.id,
        })
        return request.make_json_response(dump_attachment(attachment))
