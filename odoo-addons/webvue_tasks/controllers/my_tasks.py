# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/my-tasks: thin routes over ``webvue.my.task.service``.

The routes only parse and type-check the request; the capability checks, the
visibility rules and the field validation live in the service, so a route can
never widen what the service allows.
"""
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    require_capabilities,
    requires_feature,
)
from odoo.addons.webvue_tasks.models.my_task_service import MAX_ID, MAX_LIMIT
from odoo.addons.webvue_tasks.serializers.personal_task import (
    dump_list_item,
    dump_personal_task,
)

DEFAULT_LIMIT = 50
MAX_DIGITS = 10  # the digits of 2**31 - 1: longer strings are rejected before int() runs


def _invalid(message, field):
    raise ApiError(422, 'invalid', message, field=field)


def _body():
    """The JSON object of the request body (``{}`` without one); anything else is a 422."""
    if not request.httprequest.content_length:
        return {}
    body = request.get_json_data()
    if not isinstance(body, dict):
        _invalid('the request body must be a JSON object', 'body')
    return body


def _digits(value, field, *, minimum):
    """A decimal digit string as an int in ``minimum..2**31-1`` (longer or non-numeric input is a 422)."""
    if not (value.isascii() and value.isdigit()) or len(value) > MAX_DIGITS or int(value) < minimum:
        _invalid(f'{field} must be an integer of at least {minimum}', field)
    return min(int(value), MAX_ID - 1)


def _flag(args, field, allowed):
    value = args.get(field)
    if value is not None and value not in allowed:
        _invalid(f'{field} must be one of {sorted(allowed)}', field)
    return value


def _list_params(args):
    closed = _flag(args, 'closed', {'0', '1'}) == '1'
    assigned = _flag(args, 'assigned', {'me'}) is not None
    created = _flag(args, 'created', {'me'}) is not None
    if not assigned and not created:
        assigned = created = True
    limit = _digits(args['limit'], 'limit', minimum=1) if 'limit' in args else DEFAULT_LIMIT
    offset = _digits(args['offset'], 'offset', minimum=0) if 'offset' in args else 0
    return {
        'closed': closed,
        'assigned': assigned,
        'created': created,
        'q': (args.get('q') or '').strip() or None,
        'sort': args.get('sort', 'deadline'),
        'limit': min(limit, MAX_LIMIT),
        'offset': offset,
    }


def _summary_params(args):
    """The list's scope and search filters; the open/closed split, sort and paging do not apply."""
    params = _list_params(args)
    return {key: params[key] for key in ('q', 'assigned', 'created')}


def _require(key):
    """The capability check runs first, so a caller without it never learns what is valid."""
    request.env['webvue.my.task.service']._require(key)
    require_capabilities(key)


def _task_for(task_id):
    """An unchecked record handle: the service decides whether the caller may see or write it."""
    return request.env['project.task'].browse(task_id)


class MyTasksController(http.Controller):

    @http.route('/api/v1/my-tasks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def list_my_tasks(self, **_):
        _require('tasks.tasks.read')
        params = _list_params(request.httprequest.args)
        tasks, total = request.env['webvue.my.task.service']._search_list(**params)
        return {'items': [dump_list_item(task) for task in tasks], 'total': total}

    @http.route('/api/v1/my-tasks/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def summarize_my_tasks(self, **_):
        _require('tasks.tasks.read')
        return request.env['webvue.my.task.service']._summary(**_summary_params(request.httprequest.args))

    @http.route('/api/v1/my-tasks', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def create_my_task(self, **_):
        _require('tasks.tasks.create')
        task = request.env['webvue.my.task.service']._create_task(_body())
        return dump_personal_task(task)

    @http.route('/api/v1/my-tasks/<int:task_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('tasks.enabled', operation='read')
    def get_my_task(self, task_id, **_):
        _require('tasks.tasks.read')
        return dump_personal_task(request.env['webvue.my.task.service']._get_personal(task_id))

    @http.route('/api/v1/my-tasks/<int:task_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def update_my_task(self, task_id, **_):
        _require('tasks.tasks.write')
        body = _body()
        if not body:
            _invalid('nothing to update', 'body')
        task = request.env['webvue.my.task.service']._update_task(_task_for(task_id), body)
        return dump_personal_task(task)

    def _transition(self, task_id, action):
        _require('tasks.tasks.write')
        task = request.env['webvue.my.task.service']._transition(_task_for(task_id), action)
        return dump_personal_task(task)

    @http.route('/api/v1/my-tasks/<int:task_id>/done', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def done_my_task(self, task_id, **_):
        return self._transition(task_id, 'done')

    @http.route('/api/v1/my-tasks/<int:task_id>/reopen', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def reopen_my_task(self, task_id, **_):
        return self._transition(task_id, 'reopen')

    @http.route('/api/v1/my-tasks/<int:task_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('tasks.enabled', operation='write')
    def cancel_my_task(self, task_id, **_):
        return self._transition(task_id, 'cancel')
