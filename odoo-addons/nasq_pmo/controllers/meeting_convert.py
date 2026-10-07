# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_positive_int,
    requires_feature,
)


class MeetingResolutionConvertController(http.Controller):

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/convert',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', 'pmo.enabled', operation='write')
    def convert_resolution(self, meeting_id, resolution_id, project_id=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        task = resolution.action_convert_to_task(parse_positive_int(project_id, 'project_id'))
        return {'id': task.id, 'name': task.name}
