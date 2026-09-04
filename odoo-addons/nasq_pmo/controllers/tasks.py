# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
)
from odoo.addons.nasq_pmo.serializers.task import (
    API_TO_STATE,
    dump_task,
    dump_task_detail,
    parse_task_vals,
)

SORTABLE = {'date_deadline', 'priority', 'name', 'create_date', 'write_date'}
MAX_LIMIT = 200


class TaskController(http.Controller):

    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_tasks(self, **_):
        # type='json2' routes only merge the JSON body with path args — the query string
        # is not passed as kwargs (see odoo/http.py Json2Dispatcher). Read it ourselves.
        args = request.httprequest.args
        filter_ = args.get('filter')
        state = args.get('state')
        project_id = args.get('project_id')
        closed = args.get('closed', '0')
        q = args.get('q')
        sort = args.get('sort', 'date_deadline asc, priority desc')
        limit = args.get('limit', 50)
        offset = args.get('offset', 0)

        if filter_ not in (None, 'mine'):
            raise ApiError(400, 'unsupported_filter', "filter must be 'mine'")
        if project_id is not None:
            try:
                project_id = int(project_id)
            except ValueError:
                raise ApiError(422, 'invalid', "project_id must be an integer", field='project_id') from None
        if filter_ != 'mine' and not project_id:
            raise ApiError(400, 'unsupported_filter', "pass filter=mine and/or project_id")
        if project_id and not request.env['project.project'].search_count([('id', '=', project_id)]):
            # ACL/ir.rule decide readability; an unreadable (or nonexistent) project simply
            # yields nothing. Checked up front: project.task's own visibility rule also grants
            # read on a task assigned to the caller regardless of the project's own privacy, so
            # scoping by project_id alone would otherwise still surface that one task.
            return {'items': [], 'total': 0}
        limit = parse_nonneg_int(limit, 'limit')
        offset = parse_nonneg_int(offset, 'offset')
        # project_todo (auto-installed alongside project) gives every new internal user a
        # personal "Welcome" project.task with no project_id; the nasq task list is about
        # project work, so exclude those to-dos rather than surfacing them as "mine".
        domain = Domain('project_id', '!=', False) & Domain('is_closed', '=', closed in ('1', 'true', True))
        if filter_ == 'mine':
            domain &= Domain('user_ids', 'in', [request.env.uid])
        if project_id:
            domain &= Domain('project_id', '=', project_id)
        if state:
            # Silently dropping an unknown value used to answer 200 with a list
            # filtered by whatever was left — a typo'd filter looked like "no
            # such tasks" instead of a bad request.
            names = [s.strip() for s in str(state).split(',') if s.strip()]
            unknown = [s for s in names if s not in API_TO_STATE]
            if unknown:
                raise ApiError(422, 'invalid', f"unknown state {unknown[0]!r}", field='state')
            domain &= Domain('state', 'in', [API_TO_STATE[s] for s in names])
        if q:
            domain &= Domain('name', 'ilike', q)
        order_parts = []
        for part in str(sort).split(','):
            field, _, direction = part.strip().partition(' ')
            if field in SORTABLE:
                order_parts.append(f"{field} {'desc' if direction == 'desc' else 'asc'}")
        order = ', '.join(order_parts) or 'date_deadline asc, priority desc'
        Task = request.env['project.task']
        limit = min(limit, MAX_LIMIT)
        tasks = Task.search(domain, order=f"{order}, id desc", limit=limit, offset=offset)
        return {'items': [dump_task(t) for t in tasks], 'total': Task.search_count(domain)}

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_task(self, task_id):
        task = get_record('project.task', task_id)
        return dump_task_detail(task)

    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_task(self, name=None, project_id=None, parent_id=None, **_):
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        if not project_id:
            raise ApiError(422, 'invalid', "project_id is required", field='project_id')
        project = get_record('project.project', project_id)
        vals = {'name': name.strip(), 'project_id': project.id, 'user_ids': [(4, request.env.uid)]}
        if parent_id:
            vals['parent_id'] = get_record('project.task', parent_id).id
        task = request.env['project.task'].create(vals)
        return request.make_json_response(dump_task_detail(task), status=201)

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_task(self, task_id, **payload):
        payload.pop('task_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        task = get_record('project.task', task_id)
        vals = parse_task_vals(payload, can_manage=task._nasq_can_approve(), task=task)
        task.write(vals)
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/transition', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def transition_task(self, task_id, state=None, **_):
        if state not in API_TO_STATE:
            raise ApiError(422, 'invalid_state', f"unknown state {state!r}", field='state')
        task = get_record('project.task', task_id)
        try:
            task._nasq_transition(API_TO_STATE[state])
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        return dump_task_detail(task)
