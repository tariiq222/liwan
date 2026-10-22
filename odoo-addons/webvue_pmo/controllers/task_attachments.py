# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)
from odoo.addons.webvue_pmo.serializers.task import task_attachments_route


class TaskAttachmentController(http.Controller):

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_task_attachments(self, task_id):
        task = get_record('project.task', task_id)
        attachments = task._webvue_task_attachments()
        for attachment in attachments:
            attachment.check_access('read')
        return {
            'items': [dump_attachment(attachment, task_attachments_route(task_id)) for attachment in attachments],
            'total': len(attachments),
        }

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments/<int:attachment_id>/download',
        type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def download_task_attachment(self, task_id, attachment_id, **_):
        """The file of one direct task attachment, for a caller who can see the task."""
        task = get_record('project.task', task_id)
        return download_linked_attachment(task._webvue_task_attachments(), attachment_id)

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def upload_task_attachment(self, task_id, **payload):
        task = get_record('project.task', task_id)
        if not task._webvue_can_write():
            raise AccessError(request.env._("You are not allowed to change this task."))
        task.check_access('write')
        payload.pop('task_id', None)
        values = parse_attachment_upload(payload)
        attachment = request.env['ir.attachment'].create({
            'name': values['name'],
            'raw': values['raw'],
            'mimetype': values['mimetype'],
            'type': 'binary',
            'url': False,
            'public': False,
            'res_model': 'project.task',
            'res_id': task.id,
        })
        return request.make_json_response(dump_attachment(attachment, task_attachments_route(task.id)), status=201)

    @http.route(
        '/api/v1/tasks/<int:task_id>/attachments/<int:attachment_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_task_attachment(self, task_id, attachment_id):
        task = get_record('project.task', task_id)
        if not task._webvue_can_write():
            raise AccessError(request.env._("You are not allowed to change this task."))
        task.check_access('write')
        attachment = task._webvue_task_attachment(attachment_id)
        if not attachment:
            raise MissingError(request.env._(
                'Attachment %(attachment_id)s is not linked to task %(task_id)s',
                attachment_id=attachment_id,
                task_id=task_id,
            ))
        attachment.check_access('unlink')
        attachment.unlink()
        return request.make_json_response('', status=204)
