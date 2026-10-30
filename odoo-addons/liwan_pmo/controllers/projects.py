# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_pmo.models.project_project import (
    STATUS_VALUES,
    LiwanCharterState,
    LiwanStaleWrite,
)
from odoo.addons.liwan_pmo.serializers.project import (
    dump_project,
    dump_project_detail,
    dump_project_task_summary,
    parse_project_copy,
    parse_project_create,
    parse_project_vals,
    parse_write_token,
)
from odoo.addons.liwan_pmo.serializers.project_charter import parse_charter_vals

MAX_PROJECTS = 200
LIST_QUERY = {'minimal', 'archived', 'limit', 'offset', 'q', 'status', 'sort', 'mine', 'charter_review'}
_ABSENT = object()


class ProjectController(http.Controller):

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_projects(self, **_):
        require_capabilities('pmo.projects.read')
        args = request.httprequest.args
        unknown = set(args) - LIST_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        archived_param = args.get('archived')
        if archived_param is not None and archived_param not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "archived must be '1', 'true', '0' or 'false'", field='archived')
        mine_param = args.get('mine')
        if mine_param is not None and mine_param not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "mine must be '1', 'true', '0' or 'false'", field='mine')
        review_param = args.get('charter_review')
        if review_param is not None and review_param not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "charter_review must be '1', 'true', '0' or 'false'", field='charter_review')
        # Odoo search(limit=0) means unlimited; treat an explicit 0 as the cap.
        limit = parse_nonneg_int(args.get('limit', MAX_PROJECTS), 'limit') or MAX_PROJECTS
        limit = min(limit, MAX_PROJECTS)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        sort = args.get('sort', 'default')
        if sort not in ('default', 'name', 'progress'):
            raise ApiError(422, 'invalid', "sort must be 'default', 'name' or 'progress'", field='sort')
        status = args.get('status')
        if status is not None and status != 'unset' and status not in STATUS_VALUES:
            raise ApiError(
                422, 'invalid',
                f"status must be one of {sorted(STATUS_VALUES)} or 'unset'",
                field='status',
            )
        Project = request.env['project.project']
        archived = archived_param in ('1', 'true')
        if archived and not Project._liwan_is_manager():
            raise AccessError(request.env._("Only a project manager can list archived projects."))
        domain = [('active', '=', False)] if archived else []
        if mine_param in ('1', 'true'):
            domain.append(('user_id', '=', request.env.uid))
        if review_param in ('1', 'true'):
            domain += [('liwan_sponsor_id', '=', request.env.uid), ('liwan_charter_state', '=', 'submitted')]
        q = (args.get('q') or '').strip()
        if q:
            domain.append(('name', 'ilike', q))
        if status == 'unset':
            domain.append(('last_update_status', '=', 'to_define'))
        elif status:
            domain.append(('last_update_status', '=', status))
        Project = Project.with_context(active_test=not archived)
        if sort == 'progress':
            # This native percentage is computed with the caller's task access,
            # not stored. Sort the readable recordset before slicing; stable
            # name/id order breaks ties at the same rounded value shown in UI.
            readable = Project.search(domain, order='name, id')
            projects = readable.sorted(
                key=lambda project: -dump_project_task_summary(project)['progress'],
            )[offset:offset + limit]
        else:
            projects = Project.search(domain, order='name, id', limit=limit, offset=offset)
        if args.get('minimal') in ('1', 'true'):
            return [{'id': p.id, 'name': p.name} for p in projects]
        return {
            'items': [dump_project(p) for p in projects],
            'total': Project.search_count(domain),
            'can_create': Project._liwan_can_create(),
            'can_list_archived': Project._liwan_is_manager(),
        }

    @http.route('/api/v1/projects', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_project(self, **payload):
        Project = request.env['project.project']
        if not Project._liwan_can_create():
            raise ApiError(403, 'create_forbidden', request.env._("You are not allowed to create projects."))
        name, extra = parse_project_create(payload)
        try:
            project = Project._liwan_create_from_policy(name, extra or None)
        except LiwanAccessRule:
            raise
        except AccessError as e:
            raise ApiError(403, 'create_forbidden', str(e)) from e
        except UserError as e:
            raise ApiError(422, 'invalid', str(e)) from e
        return request.make_json_response(dump_project_detail(project), status=201)

    @http.route('/api/v1/projects/<int:project_id>/copy', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def copy_project(self, project_id, **payload):
        source = get_record('project.project', project_id)
        name, start_date, end_date = parse_project_copy(payload)
        try:
            result = source._liwan_copy_structure(name, start_date, end_date=end_date, serialize=dump_project_detail)
        except LiwanAccessRule:
            raise
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        except (ValidationError, UserError) as error:
            raise ApiError(422, 'invalid', str(error)) from error
        return request.make_json_response(result, status=201)

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_project(self, project_id):
        require_capabilities('pmo.projects.read')
        return dump_project_detail(get_record('project.project', project_id))

    @http.route('/api/v1/projects/<int:project_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_project(self, project_id, **payload):
        payload.pop('project_id', None)
        charter = payload.pop('charter', _ABSENT)
        expected = payload.pop('expected_updated_at', _ABSENT)
        if not payload and charter is _ABSENT:
            raise ApiError(422, 'invalid', "no fields to update")
        project = get_record('project.project', project_id)
        if charter is not _ABSENT and expected is _ABSENT:
            raise ApiError(422, 'invalid', "expected_updated_at is required when charter is present", field='expected_updated_at')
        if expected is not _ABSENT:
            parse_write_token(expected)
            try:
                project._liwan_lock_for_write(expected)
            except LiwanStaleWrite as e:
                raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
        else:
            project._liwan_check_manage()
        vals = parse_project_vals(payload, project) if payload else {}
        if charter is not _ABSENT:
            vals.update(parse_charter_vals(charter, project))
        if not vals:
            return dump_project_detail(project)
        try:
            project._liwan_write_as_manager(vals)
        except LiwanCharterState as e:
            raise ApiError(409, 'charter_state', str(e)) from e
        return dump_project_detail(project)

    @http.route('/api/v1/projects/<int:project_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def archive_project(self, project_id, **_):
        project = get_record('project.project', project_id)
        return dump_project_detail(project._liwan_archive())

    @http.route('/api/v1/projects/<int:project_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def unarchive_project(self, project_id, **_):
        project = request.env['project.project'].with_context(active_test=False).browse(int(project_id)).exists()
        if not project:
            raise ApiError(404, 'not_found', "project not found")
        project.check_access('read')
        return dump_project_detail(project._liwan_unarchive())

    @http.route('/api/v1/projects/<int:project_id>/status', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def set_status(self, project_id, status=None, **_):
        if not isinstance(status, str) or status not in STATUS_VALUES:
            raise ApiError(422, 'invalid_status', f"status must be one of {sorted(STATUS_VALUES)}", field='status')
        project = get_record('project.project', project_id)
        try:
            project._liwan_set_status(status)
        except AccessError as e:
            raise ApiError(403, 'status_forbidden', str(e)) from e
        return dump_project_detail(project)
