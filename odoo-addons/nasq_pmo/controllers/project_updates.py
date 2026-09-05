# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project_update import dump_update

MAX_UPDATES = 50


class ProjectUpdateController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/updates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_updates(self, project_id):
        project = get_record('project.project', project_id)
        updates = request.env['project.update'].search([('project_id', '=', project.id)], order='date desc, id desc', limit=MAX_UPDATES)
        return [dump_update(u) for u in updates]

    @http.route('/api/v1/projects/<int:project_id>/updates', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_update(self, project_id, status=None, name=None, description=None, **_):
        if not isinstance(status, str) or status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        project = get_record('project.project', project_id)
        try:
            update = project._nasq_post_update(status, name.strip(), description if isinstance(description, str) else '')
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return request.make_json_response(dump_update(update), status=201)
