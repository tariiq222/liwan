# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii
import csv
import io

from odoo import http
from odoo.http import request
from odoo.tools.mimetypes import guess_mimetype

from odoo.addons.liwan_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.attachment import MAX_ENCODED_CHARS
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_inbox.adapters import media_rules
from odoo.addons.liwan_inbox.controllers.conversations import conversation_domain
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    reject,
    visible_conversation,
    visible_message,
)
from odoo.addons.liwan_inbox.models.access_service import EXPORT, READ, REPLY
from odoo.addons.liwan_inbox.serializers.conversation import dump_attachment

EXPORT_LIMIT = 10000
EXPORT_HEADER = (
    'id', 'contact', 'phone', 'channel', 'department', 'assignee', 'state', 'priority', 'tags', 'last_message_at',
)
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')
UPLOAD_FIELDS = {'name', 'mimetype', 'data'}
MAX_FILENAME = 255
MAX_MIMETYPE = 128


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


def parse_upload_name(value):
    name = value.strip() if isinstance(value, str) else ''
    if not name or '\x00' in name or '/' in name or '\\' in name or name in {'.', '..'} or len(name) > MAX_FILENAME:
        reject('name must be a file name of at most 255 characters without a path', 'name')
    return name


def decode_upload(data):
    """The bytes of a base64 `data` string; an over-long string is refused before it is decoded."""
    if not isinstance(data, str) or not data.strip():
        reject('data is required', 'data')
    if len(data) > MAX_ENCODED_CHARS:
        raise too_large()
    cleaned = ''.join(data.split())
    if len(cleaned) > MAX_ENCODED_CHARS:
        raise too_large()
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        reject('data must be valid base64', 'data')
    if not raw:
        reject('data must contain a non-empty file', 'data')
    return raw


def parse_upload(payload):
    """(name, bytes, mimetype) of an upload body, checked against the WhatsApp type and size rules."""
    check_fields(payload, UPLOAD_FIELDS, required=sorted(UPLOAD_FIELDS))
    name = parse_upload_name(payload['name'])
    hint = payload['mimetype']
    if not isinstance(hint, str) or not 1 <= len(hint) <= MAX_MIMETYPE:
        reject('mimetype must be a string of 1 to 128 characters', 'mimetype')
    raw = decode_upload(payload['data'])
    # The sniffed content decides; the client's mimetype is only a hint (see media_rules.resolve_mimetype).
    mimetype = media_rules.resolve_mimetype(hint, guess_mimetype(raw))
    if not mimetype:
        reject('this file type cannot be sent over WhatsApp', 'data')
    if len(raw) > media_rules.limit_of(media_rules.kind_of(mimetype)):
        raise too_large()
    return name, raw, mimetype


class ConversationFilesController(http.Controller):

    @http.route('/api/v1/inbox/conversations/export.csv', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(EXPORT)
    def export_conversations(self, **_):
        domain = conversation_domain(request.httprequest.args)
        conversations = request.env['liwan.inbox.conversation']._liwan_search_visible(domain, limit=EXPORT_LIMIT)
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
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def upload_file(self, conversation_id, **payload):
        """Store a file for a later reply; it hangs on the conversation until a reply uses it or a day passes."""
        conversation = visible_conversation(conversation_id)
        name, raw, mimetype = parse_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': name, 'raw': raw, 'mimetype': mimetype, 'type': 'binary',
            'res_model': conversation._name, 'res_id': conversation.id,
        })
        return request.make_json_response(dump_attachment(attachment), status=201)
