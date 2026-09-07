# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler, get_record
from odoo.addons.nasq_pmo.serializers.task_attachment import (
    dump_task_attachment,
    parse_task_attachment_upload,
)


class MeetingAttachmentController(http.Controller):

    def _attachments(self, meeting):
        return request.env['ir.attachment'].search([
            ('res_model', '=', 'cyan.meeting.minute'),
            ('res_id', '=', meeting.id),
            ('type', '=', 'binary'),
        ])

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_meeting_attachments(self, meeting_id):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        attachments = self._attachments(meeting)
        for attachment in attachments:
            attachment.check_access('read')
        return {'items': [dump_task_attachment(item) for item in attachments], 'total': len(attachments)}

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def upload_meeting_attachment(self, meeting_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        payload.pop('meeting_id', None)
        values = parse_task_attachment_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': values['name'],
            'raw': values['raw'],
            'mimetype': values['mimetype'],
            'type': 'binary',
            'url': False,
            'public': False,
            'res_model': 'cyan.meeting.minute',
            'res_id': meeting.id,
        })
        return request.make_json_response(dump_task_attachment(attachment), status=201)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/attachments/<int:attachment_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    def delete_meeting_attachment(self, meeting_id, attachment_id):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        attachment = self._attachments(meeting).filtered(lambda item: item.id == attachment_id)
        if not attachment:
            raise MissingError(request.env._("Attachment is not linked to this meeting."))
        attachment.check_access('unlink')
        attachment.unlink()
        return request.make_json_response('', status=204)
