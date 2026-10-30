# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    get_record,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)


def _attachments_route(meeting):
    return f'/api/v1/meetings/{meeting.id}/attachments'


class MeetingAttachmentController(http.Controller):

    def _attachments(self, meeting):
        return request.env['ir.attachment'].search([
            ('res_model', '=', 'liwan.meeting.minute'),
            ('res_id', '=', meeting.id),
            ('type', '=', 'binary'),
        ])

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def list_meeting_attachments(self, meeting_id):
        require_capabilities('meetings.read')
        meeting = get_record('liwan.meeting.minute', meeting_id)
        attachments = self._attachments(meeting)
        for attachment in attachments:
            attachment.check_access('read')
        return {'items': [dump_attachment(item, _attachments_route(meeting)) for item in attachments], 'total': len(attachments)}

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/attachments/<int:attachment_id>/download',
        type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def download_meeting_attachment(self, meeting_id, attachment_id, **_):
        require_capabilities('meetings.read')
        meeting = get_record('liwan.meeting.minute', meeting_id)
        return download_linked_attachment(self._attachments(meeting), attachment_id)

    @http.route('/api/v1/meetings/<int:meeting_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def upload_meeting_attachment(self, meeting_id, **payload):
        require_capabilities('meetings.read')
        meeting = get_record('liwan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        payload.pop('meeting_id', None)
        values = parse_attachment_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': values['name'],
            'raw': values['raw'],
            'mimetype': values['mimetype'],
            'type': 'binary',
            'url': False,
            'public': False,
            'res_model': 'liwan.meeting.minute',
            'res_id': meeting.id,
        })
        return request.make_json_response(dump_attachment(attachment, _attachments_route(meeting)), status=201)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/attachments/<int:attachment_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def delete_meeting_attachment(self, meeting_id, attachment_id):
        require_capabilities('meetings.read')
        meeting = get_record('liwan.meeting.minute', meeting_id)
        if not meeting.can_edit:
            raise AccessError(request.env._("You are not allowed to change this meeting."))
        attachment = self._attachments(meeting).filtered(lambda item: item.id == attachment_id)
        if not attachment:
            raise MissingError(request.env._("Attachment is not linked to this meeting."))
        attachment.check_access('unlink')
        attachment.unlink()
        return request.make_json_response('', status=204)
