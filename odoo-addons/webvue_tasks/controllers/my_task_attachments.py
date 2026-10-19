# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/my-tasks/<id>/attachments: binary ``ir.attachment`` rows linked to the personal task.

The validator and wire shape are the shared ones; storage is counted by the ``ir.attachment``
hook of webvue_platform, so nothing here claims storage or uses ``sudo()``.
"""
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.attachment_download import (
    download_linked_attachment,
)
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_api.serializers.attachment import (
    dump_attachment,
    parse_attachment_upload,
)
from odoo.addons.webvue_tasks.controllers.my_tasks import (
    _body,
    _invalid,
    _require,
    _task_for,
)
from odoo.addons.webvue_tasks.models.my_task_service import _bad_text


def _task_attachments(task):
    return request.env['ir.attachment'].search([
        ('res_model', '=', 'project.task'), ('res_id', '=', task.id), ('type', '=', 'binary'),
    ], order='id asc')


def _attachments_route(task):
    return f'/api/v1/my-tasks/{task.id}/attachments'


class MyTaskAttachmentsController(http.Controller):

    @http.route('/api/v1/my-tasks/<int:task_id>/attachments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def list_my_task_attachments(self, task_id, **_):
        task = request.env['webvue.my.task.service']._get_personal(task_id)
        attachments = _task_attachments(task)
        return {'items': [dump_attachment(item, _attachments_route(task)) for item in attachments], 'total': len(attachments)}

    @http.route(
        '/api/v1/my-tasks/<int:task_id>/attachments/<int:att_id>/download',
        type='http', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def download_my_task_attachment(self, task_id, att_id, **_):
        task = request.env['webvue.my.task.service']._get_personal(task_id)
        return download_linked_attachment(_task_attachments(task), att_id)

    @http.route('/api/v1/my-tasks/<int:task_id>/attachments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def upload_my_task_attachment(self, task_id, **_):
        _require('tasks.tasks.write')
        # The task is resolved before the upload is decoded: a stranger's 404 never costs a base64 decode.
        task = request.env['webvue.my.task.service']._writable_personal(_task_for(task_id))
        payload = _body()
        if _bad_text(payload.get('name')):
            _invalid('name must not contain NUL or unpaired surrogates', 'name')
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
        return dump_attachment(attachment, _attachments_route(task))

    @http.route(
        '/api/v1/my-tasks/<int:task_id>/attachments/<int:att_id>',
        type='json2', auth='user', methods=['DELETE'], readonly=False,
    )
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def delete_my_task_attachment(self, task_id, att_id, **_):
        _require('tasks.tasks.write')
        task = request.env['webvue.my.task.service']._writable_personal(_task_for(task_id))
        attachment = _task_attachments(task).filtered(lambda item: item.id == att_id)
        if not attachment:
            raise ApiError(404, 'not_found', 'not_found')
        attachment.unlink()
        return request.make_json_response('', status=204)
