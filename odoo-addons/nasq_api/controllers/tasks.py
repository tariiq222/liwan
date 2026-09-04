# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request
from odoo.osv.expression import AND

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_api.serializers.task import (
    API_TO_STATE,
    dump_task,
    dump_task_detail,
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

        if filter_ != 'mine':
            raise ApiError(400, 'unsupported_filter', "phase 1 supports filter=mine only")
        # project_todo (auto-installed alongside project) gives every new internal user a
        # personal "Welcome" project.task with no project_id; the nasq task list is about
        # project work, so exclude those to-dos rather than surfacing them as "mine".
        domain = [('user_ids', 'in', [request.env.uid]), ('project_id', '!=', False)]
        domain = AND([domain, [('is_closed', '=', closed in ('1', 'true', True))]])
        if state:
            codes = [API_TO_STATE[s] for s in str(state).split(',') if s in API_TO_STATE]
            domain = AND([domain, [('state', 'in', codes)]])
        if project_id:
            domain = AND([domain, [('project_id', '=', int(project_id))]])
        if q:
            domain = AND([domain, [('name', 'ilike', q)]])
        order_parts = []
        for part in str(sort).split(','):
            field, _, direction = part.strip().partition(' ')
            if field in SORTABLE:
                order_parts.append(f"{field} {'desc' if direction == 'desc' else 'asc'}")
        order = ', '.join(order_parts) or 'date_deadline asc, priority desc'
        Task = request.env['project.task']
        limit = min(int(limit), MAX_LIMIT)
        tasks = Task.search(domain, order=f"{order}, id desc", limit=limit, offset=int(offset))
        return {'items': [dump_task(t) for t in tasks], 'total': Task.search_count(domain)}

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_task(self, task_id):
        task = get_record('project.task', task_id)
        return dump_task_detail(task)
