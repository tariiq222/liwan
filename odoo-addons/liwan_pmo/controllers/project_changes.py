# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request

from .records import get_visible_record
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    parse_page,
    parse_positive_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_pmo.models.project_change import (
    CHANGE_STATES,
    LiwanChangeControlOff,
    LiwanChangeState,
)
from odoo.addons.liwan_pmo.models.project_project import LiwanStaleWrite
from odoo.addons.liwan_pmo.serializers.project import parse_write_token
from odoo.addons.liwan_pmo.serializers.project_change import (
    dump_change,
    parse_change_vals,
)
from odoo.addons.liwan_pmo.serializers.project_charter_reference import (
    dump_catalog_item,
    parse_catalog_create,
    parse_catalog_patch,
)

FEATURES = ('pmo.enabled', 'pmo.change_control')
LIST_QUERY = {'state', 'category_id', 'limit', 'offset'}
DECISION_BODY = {
    'approve': {'expected_updated_at', 'note'},
    'reject': {'expected_updated_at', 'note'},
}


def _project(project_id):
    # Like the other governance registers, change requests stay out of reach of an archived project.
    project = get_visible_record('project.project', project_id)
    if not project.active:
        raise MissingError(request.env._("Record does not exist"))
    return project


def _change(project, change_id):
    change = request.env['liwan.project.change'].search([
        ('id', '=', change_id), ('project_id', '=', project.id),
    ], limit=1)
    if not change:
        raise MissingError(request.env._("Record does not exist"))
    return change


def _locked(change, payload, *, token_required):
    """Lock the request's row and check the write token the body carries."""
    expected = payload.pop('expected_updated_at', None)
    if expected is None and token_required:
        raise ApiError(422, 'invalid', "expected_updated_at is required", field='expected_updated_at')
    if expected is not None:
        parse_write_token(expected)
    try:
        change._liwan_lock(expected)
    except LiwanStaleWrite as error:
        raise ApiError(409, 'stale_write', str(error), field='expected_updated_at') from error


def _unknown_keys(payload, allowed):
    unknown = set(payload) - allowed
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)


def _run(project_id, change_id, payload, action):
    """One transition: lock the row, run the model's check-and-do method, answer the new request."""
    payload.pop('project_id', None)
    payload.pop('change_id', None)
    _unknown_keys(payload, DECISION_BODY.get(action, {'expected_updated_at'}))
    project = _project(project_id)
    change = _change(project, change_id)
    note = payload.get('note')
    if action == 'reject' and (not isinstance(note, str) or not note.strip()):
        raise ApiError(422, 'invalid', "note is required", field='note')
    _locked(change, payload, token_required=False)
    try:
        if action == 'approve':
            change._liwan_approve(note or '')
        elif action == 'reject':
            change._liwan_reject(note)
        else:
            getattr(change, f'_liwan_{action}')()
    except LiwanChangeState as error:
        raise ApiError(409, 'change_state', str(error)) from error
    except LiwanChangeControlOff as error:
        raise ApiError(409, 'change_control_off', str(error)) from error
    return dump_change(change)


class ProjectChangeController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/changes', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def list_changes(self, project_id):
        declare_read_capability_scope('pmo.projects.read')
        project = _project(project_id)
        args = request.httprequest.args
        unknown = set(args) - LIST_QUERY
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        domain = [('project_id', '=', project.id)]
        if args.get('state'):
            if args['state'] not in CHANGE_STATES:
                raise ApiError(422, 'invalid', "state is invalid", field='state')
            domain.append(('state', '=', args['state']))
        if args.get('category_id'):
            domain.append(('category_id', '=', parse_positive_int(args['category_id'], 'category_id')))
        limit, offset = parse_page(args)
        Change = request.env['liwan.project.change']
        return {
            'items': [dump_change(change) for change in Change.search(domain, limit=limit, offset=offset)],
            'total': Change.search_count(domain),
            'can_create': project._liwan_is_member() and request.env['liwan.pmo.settings'].change_control_mode() != 'off',
        }

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def get_change(self, project_id, change_id):
        declare_read_capability_scope('pmo.projects.read')
        return dump_change(_change(_project(project_id), change_id))

    @http.route('/api/v1/projects/<int:project_id>/changes', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def create_change(self, project_id, **payload):
        project = _project(project_id)
        vals = parse_change_vals(payload, partial=False)
        try:
            change = request.env['liwan.project.change'].create({**vals, 'project_id': project.id})
        except LiwanChangeControlOff as error:
            raise ApiError(409, 'change_control_off', str(error)) from error
        return request.make_json_response(dump_change(change), status=201)

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def patch_change(self, project_id, change_id, **payload):
        change = _change(_project(project_id), change_id)
        _locked(change, payload, token_required=True)
        vals = parse_change_vals(payload, partial=True)
        try:
            change.write(vals)
        except LiwanChangeState as error:
            raise ApiError(409, 'change_state', str(error)) from error
        except LiwanChangeControlOff as error:
            raise ApiError(409, 'change_control_off', str(error)) from error
        return dump_change(change)

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>/submit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def submit_change(self, project_id, change_id, **payload):
        return _run(project_id, change_id, payload, 'submit')

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>/withdraw', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def withdraw_change(self, project_id, change_id, **payload):
        return _run(project_id, change_id, payload, 'withdraw')

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def approve_change(self, project_id, change_id, **payload):
        return _run(project_id, change_id, payload, 'approve')

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>/reject', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def reject_change(self, project_id, change_id, **payload):
        return _run(project_id, change_id, payload, 'reject')

    @http.route('/api/v1/projects/<int:project_id>/changes/<int:change_id>/implement', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def implement_change(self, project_id, change_id, **payload):
        return _run(project_id, change_id, payload, 'implement')


class ChangeCategoryController(http.Controller):

    @http.route('/api/v1/pmo/change-categories', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def list_change_categories(self):
        require_capabilities('pmo.projects.read', 'pmo.settings.manage', match='any')
        Category = request.env['liwan.project.change.category']
        args = request.httprequest.args
        unknown = set(args) - {'active'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        active = args.get('active', '1')
        if active not in ('1', 'all'):
            raise ApiError(422, 'invalid', "active must be '1' or 'all'", field='active')
        if active == 'all' and not Category._liwan_can_manage_catalog():
            raise AccessError(request.env._("Only a settings manager can list archived categories."))
        domain = [('company_id', 'in', request.env.companies.ids)]
        if active == '1':
            domain.append(('active', '=', True))
        records = Category.with_context(active_test=False).search(domain, order='sequence, id')
        return {'items': [dump_catalog_item(record) for record in records], 'total': len(records)}

    @http.route('/api/v1/pmo/change-categories', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def create_change_category(self, **payload):
        record = request.env['liwan.project.change.category'].create(parse_catalog_create(payload))
        return request.make_json_response(dump_catalog_item(record), status=201)

    @http.route('/api/v1/pmo/change-categories/<int:category_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    def patch_change_category(self, category_id, **payload):
        Category = request.env['liwan.project.change.category']
        record = Category.with_context(active_test=False).search([
            ('id', '=', category_id), ('company_id', 'in', request.env.companies.ids),
        ], limit=1)
        if not record:
            raise MissingError(request.env._("Record does not exist"))
        record.write(parse_catalog_patch(payload))
        return dump_catalog_item(record)
