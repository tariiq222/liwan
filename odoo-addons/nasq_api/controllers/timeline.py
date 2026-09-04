# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_api.serializers.timeline import dump_message


class TimelineController(http.Controller):

    def _timeline_messages(self, task):
        # tracking_value_ids is group_system-only on mail.message (see mail_message.py); read it
        # sudo'd purely to test presence, mirroring the pattern mail's own Store computation uses.
        comment_subtype = request.env.ref('mail.mt_comment')
        return task.message_ids.filtered(
            lambda m: (m.message_type == 'comment' and m.subtype_id == comment_subtype) or m.sudo().tracking_value_ids,
        ).sorted(key=lambda m: (m.date, m.id), reverse=True)

    @http.route('/api/v1/tasks/<int:task_id>/timeline', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def timeline(self, task_id):
        task = get_record('project.task', task_id)
        return [dump_message(m) for m in self._timeline_messages(task)]

    @http.route('/api/v1/tasks/<int:task_id>/comments', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def post_comment(self, task_id, body=None, **_):
        if not isinstance(body, str) or not body.strip():
            raise ApiError(422, 'invalid', "body must not be empty", field='body')
        task = get_record('project.task', task_id)
        message = task.message_post(body=body, message_type='comment', subtype_xmlid='mail.mt_comment', body_is_html=True)
        return request.make_json_response(dump_message(message), status=201)
