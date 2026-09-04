# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, **_):
        # json2 routes do not receive query-string params as kwargs — read them from the
        # raw request (see the same note in controllers/tasks.py::list_tasks).
        args = request.httprequest.args
        minimal = args.get('minimal')
        if minimal not in ('1', 'true'):
            raise ApiError(400, 'unsupported_filter', "phase 1 supports minimal=1 only")
        projects = request.env['project.project'].search([], order='name')
        return [{'id': p.id, 'name': p.name} for p in projects]
