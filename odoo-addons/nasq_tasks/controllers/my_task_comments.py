# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/my-tasks/<id>/comments: plain-text comments stored as ``mail.message`` on the task."""
from odoo import http
from odoo.http import request
from odoo.tools import plaintext2html

from odoo.addons.nasq_api.controllers.common import api_handler, requires_feature
from odoo.addons.nasq_tasks.controllers.my_tasks import (
    _body,
    _invalid,
    _require,
    _task_for,
)
from odoo.addons.nasq_tasks.models.my_task_service import _bad_text
from odoo.addons.nasq_tasks.serializers.personal_task import dump_comment

MAX_COMMENT_LENGTH = 5000


def _comment_text(body):
    """The stripped comment text of a request body ``{body: str}``; anything else is a 422."""
    for key in body:
        if key != 'body':
            _invalid(f'{key} is not supported', key)
    text = body.get('body')
    text = text.strip() if isinstance(text, str) else None
    if not text or len(text) > MAX_COMMENT_LENGTH or _bad_text(text):
        _invalid(f'body is required, at most {MAX_COMMENT_LENGTH} characters and without NUL or unpaired surrogates', 'body')
    return text


class MyTaskCommentsController(http.Controller):

    @http.route('/api/v1/my-tasks/<int:task_id>/comments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def list_my_task_comments(self, task_id, **_):
        task = request.env['nasq.my.task.service']._get_personal(task_id)
        messages = request.env['mail.message'].search([
            ('model', '=', 'project.task'), ('res_id', '=', task.id), ('message_type', '=', 'comment'),
        ], order='date asc, id asc')
        return {'items': [dump_comment(message) for message in messages], 'total': len(messages)}

    @http.route('/api/v1/my-tasks/<int:task_id>/comments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def post_my_task_comment(self, task_id, **_):
        _require('tasks.tasks.write')
        task = request.env['nasq.my.task.service']._writable_personal(_task_for(task_id))
        text = _comment_text(_body())
        # v1: no mentions, no task references, no notification of its own.
        message = task.message_post(
            body=plaintext2html(text), message_type='comment', subtype_xmlid='mail.mt_comment')
        return dump_comment(message)
