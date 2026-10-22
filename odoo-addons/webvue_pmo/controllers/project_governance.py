# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, ValidationError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.models.project_governance import (
    GOVERNANCE_ROLES,
    REGISTER_KINDS,
    REGISTER_PRIORITIES,
    REGISTER_STATUSES,
    StakeholderAssignmentError,
    _date_only,
)
from odoo.addons.webvue_pmo.serializers.project_governance import (
    dump_raci,
    dump_register,
    dump_stakeholder,
)

MAX_ITEMS = 200
STAKEHOLDER_FIELDS = {'name', 'user_id', 'organization', 'role', 'contact', 'notes'}
RACI_FIELDS = {'task_id', 'stakeholder_id', 'role'}
REGISTER_FIELDS = {
    'kind', 'title', 'description', 'priority', 'status', 'owner_id', 'due_date',
    'response', 'task_id', 'probability', 'impact',
}


def _page(args, allowed):
    unknown = set(args) - allowed
    if unknown:
        raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
    limit = min(parse_nonneg_int(args.get('limit', MAX_ITEMS), 'limit') or MAX_ITEMS, MAX_ITEMS)
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    return offset, limit


def _list(items, offset, limit, can_manage):
    return {'items': items[offset:offset + limit], 'total': len(items), 'can_manage': can_manage}


def _paged(model_name, domain, args, order, allowed):
    offset, limit = _page(args, allowed)
    model = request.env[model_name]
    total = model.search_count(domain)
    records = model.search(domain, order=order, offset=offset, limit=limit)
    return records, total


def _task_visible(task):
    if not task:
        return False
    try:
        task.check_access('read')
        return True
    except AccessError:
        return False


def _project(project_id):
    # get_record answers the uniform not-found for a foreign-company project
    # and lets the pinned record rules decide the rest; no duplicate company
    # check here. Governance stays out of scope for archived projects.
    project = get_record('project.project', project_id)
    if not project.active:
        raise ApiError(404, 'not_found', 'project not found')
    return project


def _require_manage(project):
    try:
        project._webvue_check_manage()
    except AccessError as error:
        raise ApiError(403, 'forbidden', str(error)) from error


def _body_fields(payload, allowed):
    unknown = set(payload) - allowed
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)


def _user_id(value, field):
    if value is None:
        return False
    user_id = parse_positive_int(value, field)
    user = request.env['res.users'].search([
        ('id', '=', user_id), ('active', '=', True), ('share', '=', False),
        ('company_ids', 'in', [request.env.company.id]),
    ], limit=1)
    if not user:
        raise ApiError(422, 'invalid', f"{field} must be an active internal user in the current company", field=field)
    return user.id


def _same_project(model, record_id, project, field, missing=False):
    value = parse_positive_int(record_id, field)
    record = request.env[model].search([('id', '=', value), ('project_id', '=', project.id)], limit=1)
    if not record:
        if missing:
            raise ApiError(404, 'not_found', 'governance record not found')
        raise ApiError(422, 'invalid', f"{field} must belong to this project", field=field)
    return record


def _stakeholder_vals(payload):
    _body_fields(payload, STAKEHOLDER_FIELDS)
    vals = dict(payload)
    if 'name' in vals:
        if not isinstance(vals['name'], str) or not vals['name'].strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        vals['name'] = vals['name'].strip()
    for field in ('organization', 'role', 'contact', 'notes'):
        if field in vals and vals[field] is not None and not isinstance(vals[field], str):
            raise ApiError(422, 'invalid', f'{field} must be a string', field=field)
        if field in vals:
            vals[field] = vals[field] or ''
    if 'user_id' in vals:
        vals['user_id'] = _user_id(vals['user_id'], 'user_id')
    return vals


def _raci_vals(payload, project):
    _body_fields(payload, RACI_FIELDS)
    vals = dict(payload)
    if 'task_id' in vals:
        vals['task_id'] = _same_project('project.task', vals['task_id'], project, 'task_id').id
    if 'stakeholder_id' in vals:
        vals['stakeholder_id'] = _same_project('webvue.project.stakeholder', vals['stakeholder_id'], project, 'stakeholder_id').id
    if 'role' in vals and vals['role'] not in GOVERNANCE_ROLES:
        raise ApiError(422, 'invalid', 'role must be R, A, C or I', field='role')
    return vals


def _register_vals(payload, project):
    _body_fields(payload, REGISTER_FIELDS)
    vals = dict(payload)
    if 'kind' in vals and vals['kind'] not in REGISTER_KINDS:
        raise ApiError(422, 'invalid', 'kind must be risk or issue', field='kind')
    if 'title' in vals:
        if not isinstance(vals['title'], str) or not vals['title'].strip():
            raise ApiError(422, 'invalid', 'title must not be empty', field='title')
        vals['title'] = vals['title'].strip()
    for field in ('description', 'response'):
        if field in vals and vals[field] is not None and not isinstance(vals[field], str):
            raise ApiError(422, 'invalid', f'{field} must be a string', field=field)
        if field in vals:
            vals[field] = vals[field] or ''
    if 'priority' in vals and vals['priority'] not in REGISTER_PRIORITIES:
        raise ApiError(422, 'invalid', 'priority is invalid', field='priority')
    if 'status' in vals and vals['status'] not in REGISTER_STATUSES:
        raise ApiError(422, 'invalid', 'status is invalid', field='status')
    if 'owner_id' in vals:
        vals['owner_id'] = _user_id(vals['owner_id'], 'owner_id')
    if 'due_date' in vals:
        vals['due_date'] = _date_only(vals['due_date'])
    if 'task_id' in vals and vals['task_id'] is not None:
        vals['task_id'] = _same_project('project.task', vals['task_id'], project, 'task_id').id
    for field in ('probability', 'impact'):
        if field in vals and (not isinstance(vals[field], int) or isinstance(vals[field], bool) or vals[field] < 1 or vals[field] > 5):
            raise ApiError(422, 'invalid', f'{field} must be an integer from 1 to 5', field=field)
    if vals.get('kind') == 'issue' and ('probability' in vals or 'impact' in vals):
        raise ApiError(422, 'invalid', 'issues cannot include probability or impact', field='kind')
    return vals


class ProjectGovernanceController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/stakeholders', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_stakeholders(self, project_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        args = request.httprequest.args
        q = (args.get('q') or '').strip()
        domain = [('project_id', '=', project.id)]
        if q:
            domain += ['|', '|', '|', ('name', 'ilike', q), ('organization', 'ilike', q), ('role', 'ilike', q), ('contact', 'ilike', q)]
        records, total = _paged('webvue.project.stakeholder', domain, args, 'name, id', {'q', 'limit', 'offset'})
        return {'items': [dump_stakeholder(item) for item in records], 'total': total, 'can_manage': project._webvue_can_manage()}

    @http.route('/api/v1/projects/<int:project_id>/stakeholders/<int:item_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_stakeholder(self, project_id, item_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        item = _same_project('webvue.project.stakeholder', item_id, project, 'stakeholder_id', missing=True)
        return dump_stakeholder(item)

    @http.route('/api/v1/projects/<int:project_id>/stakeholders', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_stakeholder(self, project_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        vals = _stakeholder_vals(payload)
        vals['project_id'] = project.id
        return request.make_json_response(dump_stakeholder(request.env['webvue.project.stakeholder'].create(vals)), status=201)

    @http.route('/api/v1/projects/<int:project_id>/stakeholders/<int:item_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_stakeholder(self, project_id, item_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        item = _same_project('webvue.project.stakeholder', item_id, project, 'stakeholder_id', missing=True)
        vals = _stakeholder_vals(payload)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        item.write(vals)
        return dump_stakeholder(item)

    @http.route('/api/v1/projects/<int:project_id>/stakeholders/<int:item_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_stakeholder(self, project_id, item_id):
        project = _project(project_id)
        _require_manage(project)
        item = _same_project('webvue.project.stakeholder', item_id, project, 'stakeholder_id', missing=True)
        try:
            item.unlink()
        except StakeholderAssignmentError as error:
            return request.make_json_response({'code': 'stakeholder_assigned', 'message': str(error)}, status=409)
        return request.make_json_response('', status=204)

    @http.route('/api/v1/projects/<int:project_id>/raci', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_raci(self, project_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        args = request.httprequest.args
        domain = [('project_id', '=', project.id)]
        for key, field, maximum in (('task_ids', 'task_id', 50), ('stakeholder_ids', 'stakeholder_id', 10)):
            if key in args:
                values = args[key].split(',') if args[key] else []
                if len(values) > maximum:
                    raise ApiError(422, 'invalid', 'too many matrix ids', field=key)
                domain.append((field, 'in', [parse_positive_int(value, key) for value in values]))
        records, total = _paged('webvue.project.raci', domain, args, 'task_id, stakeholder_id, id', {'task_ids', 'stakeholder_ids', 'limit', 'offset'})
        return {'items': [dump_raci(item) for item in records], 'total': total, 'can_manage': project._webvue_can_manage()}

    @http.route('/api/v1/projects/<int:project_id>/raci', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_raci(self, project_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        vals = _raci_vals(payload, project)
        if set(vals) != RACI_FIELDS:
            raise ApiError(422, 'invalid', 'task_id, stakeholder_id and role are required')
        vals['project_id'] = project.id
        try:
            row = request.env['webvue.project.raci'].create(vals)
        except ValidationError as error:
            raise ApiError(422, 'invalid', str(error)) from error
        return request.make_json_response(dump_raci(row), status=201)

    @http.route('/api/v1/projects/<int:project_id>/raci/<int:item_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_raci(self, project_id, item_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        row = _same_project('webvue.project.raci', item_id, project, 'raci_id', missing=True)
        vals = _raci_vals(payload, project)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        row.write(vals)
        return dump_raci(row)

    @http.route('/api/v1/projects/<int:project_id>/raci/<int:item_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_raci(self, project_id, item_id):
        project = _project(project_id)
        _require_manage(project)
        row = _same_project('webvue.project.raci', item_id, project, 'raci_id', missing=True)
        row.unlink()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/projects/<int:project_id>/register', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_register(self, project_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        args = request.httprequest.args
        domain = [('project_id', '=', project.id)]
        for key in ('kind', 'status', 'priority'):
            if args.get(key):
                value = args[key]
                allowed = {'kind': REGISTER_KINDS, 'status': REGISTER_STATUSES, 'priority': REGISTER_PRIORITIES}[key]
                if value not in allowed:
                    raise ApiError(422, 'invalid', f'{key} is invalid', field=key)
                domain.append((key, '=', value))
        q = (args.get('q') or '').strip()
        if q:
            domain += ['|', '|', ('title', 'ilike', q), ('description', 'ilike', q), ('response', 'ilike', q)]
        records, total = _paged('webvue.project.register', domain, args, 'priority, due_date, id', {'q', 'kind', 'status', 'priority', 'limit', 'offset'})
        return {'items': [dump_register(item, include_task=_task_visible(item.task_id)) for item in records], 'total': total, 'can_manage': project._webvue_can_manage()}

    @http.route('/api/v1/projects/<int:project_id>/register/<int:item_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_register(self, project_id, item_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        item = _same_project('webvue.project.register', item_id, project, 'register_id', missing=True)
        include_task = _task_visible(item.task_id)
        return dump_register(item, include_task=include_task)

    @http.route('/api/v1/projects/<int:project_id>/register', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_register(self, project_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        vals = _register_vals(payload, project)
        if not {'kind', 'title'} <= set(vals):
            raise ApiError(422, 'invalid', 'kind and title are required')
        vals['project_id'] = project.id
        item = request.env['webvue.project.register'].create(vals)
        return request.make_json_response(dump_register(item), status=201)

    @http.route('/api/v1/projects/<int:project_id>/register/<int:item_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_register(self, project_id, item_id, **payload):
        project = _project(project_id)
        _require_manage(project)
        item = _same_project('webvue.project.register', item_id, project, 'register_id', missing=True)
        vals = _register_vals(payload, project)
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        item.write(vals)
        return dump_register(item)

    @http.route('/api/v1/projects/<int:project_id>/register/<int:item_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_register(self, project_id, item_id):
        project = _project(project_id)
        _require_manage(project)
        item = _same_project('webvue.project.register', item_id, project, 'register_id', missing=True)
        item.unlink()
        return request.make_json_response('', status=204)
