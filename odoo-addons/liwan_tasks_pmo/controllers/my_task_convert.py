# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_positive_int,
    requires_feature,
)


class MyTaskConvertController(http.Controller):

    # /convert-targets never matches the <int:task_id> routes of the tasks application:
    # the int converter only accepts digits.
    @http.route('/api/v1/my-tasks/convert-targets', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', 'pmo.enabled', operation='read')
    def convert_targets(self, **_):
        convert = request.env['liwan.my.task.convert']
        convert._require('tasks.tasks.read')
        convert._require('pmo.projects.read')
        # type='json2' routes do not pass the query string as kwargs; read it directly.
        projects = convert._targets(request.httprequest.args.get('q'))
        items = [{'id': project.id, 'name': project.name} for project in projects]
        return {'items': items, 'total': len(items)}

    @http.route('/api/v1/my-tasks/<int:task_id>/convert', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', 'pmo.enabled', operation='write')
    def convert_task(self, task_id, project_id=None, **_):
        # Checked before the project is looked up, so a caller without PMO rights gets 403, never a project 422.
        convert = request.env['liwan.my.task.convert']
        convert._require('pmo.projects.read')
        project_id = parse_positive_int(project_id, 'project_id')
        return {'href': convert._convert(task_id, project_id)}
