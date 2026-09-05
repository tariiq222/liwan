# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project import (
    dump_project,
    dump_project_detail,
    parse_project_vals,
)

MAX_PROJECTS = 200


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, **_):
        args = request.httprequest.args
        unknown = set(args) - {'minimal', 'archived'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        Project = request.env['project.project']
        archived = args.get('archived') in ('1', 'true')
        if archived and not Project._nasq_is_manager():
            raise AccessError(request.env._("Only a project manager can list archived projects."))
        domain = [('active', '=', False)] if archived else []
        projects = Project.with_context(active_test=not archived).search(domain, order='name, id', limit=MAX_PROJECTS)
        if args.get('minimal') in ('1', 'true'):
            return [{'id': p.id, 'name': p.name} for p in projects]
        return {'items': [dump_project(p) for p in projects], 'can_create': Project._nasq_can_create()}

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_project(self, name=None, **_):
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        try:
            project = request.env['project.project']._nasq_create_from_policy(name.strip())
        except AccessError as e:
            raise ApiError(403, 'create_forbidden', str(e)) from e
        return request.make_json_response(dump_project_detail(project), status=201)

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_project(self, project_id):
        return dump_project_detail(get_record('project.project', project_id))

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_project(self, project_id, **payload):
        payload.pop('project_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        project = get_record('project.project', project_id)
        project._nasq_write_as_manager(parse_project_vals(payload))
        return dump_project_detail(project)

    @http.route('/api/v1/projects/<int:project_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def archive_project(self, project_id, **_):
        project = get_record('project.project', project_id)
        return dump_project_detail(project._nasq_archive())

    @http.route('/api/v1/projects/<int:project_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def unarchive_project(self, project_id, **_):
        project = request.env['project.project'].with_context(active_test=False).browse(int(project_id)).exists()
        if not project:
            raise ApiError(404, 'not_found', "project not found")
        project.check_access('read')
        return dump_project_detail(project._nasq_unarchive())

    @http.route('/api/v1/projects/<int:project_id>/status', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def set_status(self, project_id, status=None, **_):
        if not isinstance(status, str) or status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        project = get_record('project.project', project_id)
        try:
            project._nasq_set_status(status)
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return dump_project_detail(project)
