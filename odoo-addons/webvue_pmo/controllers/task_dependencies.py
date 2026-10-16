# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, ValidationError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.serializers.task import STATE_TO_API, dump_task_detail


class TaskDependencyController(http.Controller):

    @http.route('/api/v1/tasks/<int:task_id>/dependencies', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_dependencies(self, task_id):
        task = get_record('project.task', task_id)
        task._webvue_check_visible_current()
        if not task.project_id or not task.project_id.active or task.project_id.company_id != request.env.company:
            return {'items': [], 'total': 0, 'can_manage': False, 'enabled': False}
        dependencies = request.env['project.task'].search([
            ('id', 'in', task.depend_on_ids.ids),
            ('company_id', '=', request.env.company.id),
            ('project_id', '=', task.project_id.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', request.env.company.id),
        ])
        return {
            'items': [
                {'id': dep.id, 'name': dep.name, 'state': dep_state(dep)}
                for dep in dependencies
            ],
            'total': len(dependencies),
            'can_manage': bool(task._webvue_can_manage_dependencies()),
            'enabled': bool(task.allow_task_dependencies),
        }

    @http.route('/api/v1/tasks/<int:task_id>/dependencies/candidates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_candidates(self, task_id, **_):
        task = get_record('project.task', task_id)
        task._webvue_check_visible_current()
        args = request.httprequest.args
        if not task.project_id:
            return {'items': [], 'total': 0}
        if not task.project_id.active or task.project_id.company_id != request.env.company:
            return {'items': [], 'total': 0}
        unknown = set(args) - {'q', 'limit', 'offset'}
        if unknown:
            raise ApiError(400, 'unsupported_filter', f"unsupported query parameter {sorted(unknown)[0]!r}")
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), 200)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = [
            ('active', '=', True),
            ('company_id', '=', request.env.company.id),
            ('project_id', '=', task.project_id.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', request.env.company.id),
            ('id', '!=', task.id),
        ]
        if args.get('q'):
            domain.append(('name', 'ilike', args['q']))
        Candidate = request.env['project.task']
        candidates = Candidate.search(domain, order='name, id', limit=limit, offset=offset)
        return {
            'items': [
                {'id': candidate.id, 'name': candidate.name, 'state': STATE_TO_API[candidate.state]}
                for candidate in candidates
            ],
            'total': Candidate.search_count(domain),
        }

    @http.route('/api/v1/tasks/<int:task_id>/dependencies', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def set_dependencies(self, task_id, ids=None, **_):
        task = get_record('project.task', task_id)
        if not isinstance(ids, list) or any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in ids):
            raise ApiError(422, 'invalid', 'ids must be a list of positive integers', field='ids')
        if len(ids) != len(set(ids)):
            raise ApiError(422, 'invalid', 'ids must contain unique values', field='ids')
        try:
            task._webvue_set_dependencies(ids)
        except AccessError as error:
            raise ApiError(403, 'forbidden', str(error)) from error
        except ValidationError as error:
            raise ApiError(422, 'invalid', str(error), field='ids') from error
        return dump_task_detail(task)


def dep_state(task):
    return STATE_TO_API[task.state]
