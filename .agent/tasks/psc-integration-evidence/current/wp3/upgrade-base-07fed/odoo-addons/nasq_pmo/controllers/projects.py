# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.models.project_project import STATUS_VALUES
from odoo.addons.nasq_pmo.serializers.project import (
    dump_project,
    dump_project_detail,
    parse_project_vals,
)

MAX_PROJECTS = 200
LIST_QUERY = {'minimal', 'archived', 'limit', 'offset', 'q', 'status'}


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_projects(self, **_):
        request.env['nasq.access.service']._nasq_require_capability(
            'pmo.projects.read',
        )
        args = request.httprequest.args
        unknown = set(args) - LIST_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        archived_param = args.get('archived')
        if archived_param is not None and archived_param not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "archived must be '1', 'true', '0' or 'false'", field='archived')
        # Odoo search(limit=0) means unlimited; treat an explicit 0 as the cap.
        limit = parse_nonneg_int(args.get('limit', MAX_PROJECTS), 'limit') or MAX_PROJECTS
        limit = min(limit, MAX_PROJECTS)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        status = args.get('status')
        if status is not None and status != 'unset' and status not in STATUS_VALUES:
            raise ApiError(
                422, 'invalid',
                f"status must be one of {sorted(STATUS_VALUES)} or 'unset'",
                field='status',
            )
        Project = request.env['project.project']
        archived = archived_param in ('1', 'true')
        if archived and not Project._nasq_is_manager():
            raise AccessError(request.env._("Only a project manager can list archived projects."))
        domain = [('active', '=', False)] if archived else []
        q = (args.get('q') or '').strip()
        if q:
            domain.append(('name', 'ilike', q))
        if status == 'unset':
            domain.append(('last_update_status', '=', 'to_define'))
        elif status:
            domain.append(('last_update_status', '=', status))
        Project = Project.with_context(active_test=not archived)
        projects = Project.search(domain, order='name, id', limit=limit, offset=offset)
        if args.get('minimal') in ('1', 'true'):
            return [{'id': p.id, 'name': p.name} for p in projects]
        return {
            'items': [dump_project(p) for p in projects],
            'total': Project.search_count(domain),
            'can_create': Project._nasq_can_create(),
            'can_list_archived': Project._nasq_is_manager(),
        }

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
        request.env['nasq.access.service']._nasq_require_capability(
            'pmo.projects.read',
        )
        return dump_project_detail(get_record('project.project', project_id))

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_project(self, project_id, **payload):
        payload.pop('project_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        project = get_record('project.project', project_id)
        project._nasq_check_manage()
        vals = parse_project_vals(payload)
        project._nasq_write_as_manager(vals)
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
