# Part of Odoo. See LICENSE file for full copyright and licensing details.
import csv
import io

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.controllers.conversations import conversation_domain
from odoo.addons.webvue_inbox.controllers.helpers import visible_message
from odoo.addons.webvue_inbox.models.access_service import EXPORT, READ

EXPORT_LIMIT = 10000
EXPORT_HEADER = (
    'id', 'contact', 'phone', 'channel', 'department', 'assignee', 'state', 'priority', 'tags', 'last_message_at',
)
FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


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
