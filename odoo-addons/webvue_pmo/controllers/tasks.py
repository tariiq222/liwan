# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_pmo.models.project_task import _validate_task_deliverables
from odoo.addons.webvue_pmo.serializers.dates import parse_date
from odoo.addons.webvue_pmo.serializers.task import (
    API_TO_STATE,
    _parse_deadline,
    _today,
    dump_task,
    dump_task_detail,
    local_day_start_utc,
    parse_task_vals,
    task_counts,
    today_start_utc,
)

SORTABLE = {'id', 'date_deadline', 'priority', 'name', 'create_date', 'write_date'}
DEFAULT_SORT = 'id asc'
MAX_LIMIT = 200
_MISSING = object()
DEADLINE_FILTERS = ('overdue', 'today', 'week', 'none')
PRIORITIES = ('0', '1', '2', '3')


def _parse_deliverables(value):
    if not isinstance(value, list):
        raise ApiError(422, 'invalid', "deliverables must be a list", field='deliverables')
    try:
        return _validate_task_deliverables(value, request.env)
    except ValidationError as error:
        raise ApiError(422, 'invalid', str(error), field='deliverables') from error


def _parse_description(value):
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', "description must be a string", field='description')
    return value


def _assignee_domain(value):
    """`assignee`: `me` (the caller is among the assignees), `none` (nobody is) or a readable user id."""
    if value == 'me':
        return Domain('user_ids', 'in', [request.env.uid])
    if value == 'none':
        return Domain('user_ids', '=', False)
    user_id = parse_positive_int(value, 'assignee')
    if not request.env['res.users'].search_count([('id', '=', user_id)]):
        raise ApiError(422, 'invalid', "assignee must be 'me', 'none' or the id of a readable user", field='assignee')
    return Domain('user_ids', 'in', [user_id])


def _deadline_domain(value, Task):
    """`deadline`, in the caller's own timezone and with the same day boundary as `is_overdue`.

    `overdue` is a deadline before today and only ever matches open tasks; `today` is the caller's
    calendar day; `week` runs from today to the end of the current week, which starts on the day of the
    caller's language (`res.lang.week_start`, Monday-based by default) and so ends at the next week start;
    `none` is a task without a deadline.
    """
    if value not in DEADLINE_FILTERS:
        raise ApiError(422, 'invalid', f"deadline must be one of {', '.join(DEADLINE_FILTERS)}", field='deadline')
    if value == 'none':
        return Domain('date_deadline', '=', False)
    today = _today(Task)
    if value == 'overdue':
        return Domain('date_deadline', '<', today_start_utc(Task)) & Domain('is_closed', '=', False)
    if value == 'today':
        end = today + timedelta(days=1)
    else:
        lang = request.env['res.lang']._lang_get(request.env.user.lang or 'en_US')
        week_start = int(lang.week_start or 1)
        end = today + timedelta(days=7 - (today.isoweekday() - week_start) % 7)
    return Domain('date_deadline', '>=', today_start_utc(Task)) & Domain('date_deadline', '<', local_day_start_utc(Task, end))


def _priority_domain(value):
    """`priority`: one value `0`-`3` or a comma list; `3` is urgent."""
    names = list(dict.fromkeys(p.strip() for p in str(value).split(',') if p.strip()))
    unknown = [p for p in names if p not in PRIORITIES]
    if unknown or not names:
        raise ApiError(422, 'invalid', f"unknown priority {(unknown or [value])[0]!r}", field='priority')
    return Domain('priority', 'in', names)


def _filtered_task_domain(args):
    """The domain for the task filters shared by the list and the summary.

    Reads `filter`, `project_id`, `state`, `q`, `assignee`, `deadline` and `priority` from the query string
    `args`; the open/closed split (`closed`) is left to the caller. All of them combine with AND, and
    `assignee` alone is a valid scope (so `assignee=none` lists every readable unassigned task). Returns
    None when the requested project is not readable, so the caller answers with an empty set.
    """
    filter_ = args.get('filter')
    state = args.get('state')
    project_id = args.get('project_id')
    q = args.get('q')
    assignee = args.get('assignee')
    deadline = args.get('deadline')
    priority = args.get('priority')
    if filter_ not in (None, 'mine'):
        raise ApiError(400, 'unsupported_filter', "filter must be 'mine'")
    if project_id is not None:
        try:
            project_id = int(project_id)
        except ValueError:
            raise ApiError(422, 'invalid', "project_id must be an integer", field='project_id') from None
        if project_id <= 0:
            raise ApiError(422, 'invalid', "project_id must be a positive integer", field='project_id')
    if filter_ != 'mine' and project_id is None and assignee is None:
        raise ApiError(400, 'unsupported_filter', "pass filter=mine, project_id and/or assignee")
    Task = request.env['project.task']
    # Validated before the project check so a bad value is a 422 whatever the project's visibility.
    filters = Domain.TRUE
    if assignee is not None:
        filters &= _assignee_domain(assignee)
    if deadline is not None:
        filters &= _deadline_domain(deadline, Task)
    if priority is not None:
        filters &= _priority_domain(priority)
    if project_id is not None and not request.env['project.project'].search_count([('id', '=', project_id)]):
        # ACL/ir.rule decide readability; an unreadable (or nonexistent) project simply
        # yields nothing. Checked up front: project.task's own visibility rule also grants
        # read on a task assigned to the caller regardless of the project's own privacy, so
        # scoping by project_id alone would otherwise still surface that one task.
        return None
    # project_todo (auto-installed alongside project) gives every new internal user a
    # personal "Welcome" project.task with no project_id; the webvue task list is about
    # project work, so exclude those to-dos rather than surfacing them as "mine".
    domain = Domain('project_id', '!=', False) & filters
    if filter_ == 'mine':
        domain &= Domain('user_ids', 'in', [request.env.uid])
    if project_id is not None:
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
    return domain


def _task_order(sort):
    """The ORM order for a `sort` query value: known keys only, a task without a deadline always last,
    and `id asc` as the final tiebreaker so paging stays stable."""
    parts = {}
    for part in str(sort).split(','):
        field, _, direction = part.strip().partition(' ')
        if field in SORTABLE and field not in parts:
            parts[field] = f"{field} {'desc' if direction.strip() == 'desc' else 'asc'}"
            if field == 'date_deadline':
                parts[field] += ' nulls last'
    parts.setdefault('id', 'id asc')
    return ', '.join(parts.values())


class TaskController(http.Controller):

    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_tasks(self, **_):
        request.env['webvue.access.service']._webvue_require_capability(
            'pmo.tasks.read',
        )
        # type='json2' routes only merge the JSON body with path args — the query string
        # is not passed as kwargs (see odoo/http.py Json2Dispatcher). Read it ourselves.
        args = request.httprequest.args
        sort = args.get('sort', DEFAULT_SORT)
        limit = args.get('limit', 50)
        offset = args.get('offset', 0)
        limit = parse_nonneg_int(limit, 'limit') or 50
        offset = parse_nonneg_int(offset, 'offset')
        domain = _filtered_task_domain(args)
        if domain is None:
            return {'items': [], 'total': 0}
        domain &= Domain('is_closed', '=', args.get('closed', '0') in ('1', 'true', True))
        order = _task_order(sort)
        Task = request.env['project.task']
        limit = min(limit, MAX_LIMIT)
        tasks = Task.search(domain, order=order, limit=limit, offset=offset)
        counts = task_counts(tasks)
        return {'items': [dump_task(t, counts=counts) for t in tasks], 'total': Task.search_count(domain)}

    @http.route('/api/v1/tasks/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def summarize_tasks(self, **_):
        """Counts for the tasks the list filters select (the list's `total` equals `total` here).

        `open` is unfinished tasks, `overdue` the open ones past their deadline, and `done` completed tasks only;
        a cancelled task counts in `total` but in neither `open` nor `done`. `closed` and paging keys are ignored.
        """
        request.env['webvue.access.service']._webvue_require_capability(
            'pmo.tasks.read',
        )
        domain = _filtered_task_domain(request.httprequest.args)
        if domain is None:
            return {'total': 0, 'open': 0, 'overdue': 0, 'done': 0}
        Task = request.env['project.task']
        # The open/closed split is the summary's own output, so `closed` is not a filter here.
        # `done` counts completed tasks only: a cancelled task is in `total` but in neither `open` nor `done`.
        open_domain = domain & Domain('is_closed', '=', False)
        overdue_domain = open_domain & Domain('date_deadline', '<', today_start_utc(Task))
        return {
            'total': Task.search_count(domain),
            'open': Task.search_count(open_domain),
            'overdue': Task.search_count(overdue_domain),
            'done': Task.search_count(domain & Domain('state', '=', API_TO_STATE['done'])),
        }

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def get_task(self, task_id):
        request.env['webvue.access.service']._webvue_require_capability(
            'pmo.tasks.read',
        )
        task = get_record('project.task', task_id)
        return dump_task_detail(task)

    @http.route('/api/v1/tasks', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def create_task(
        self, name=None, project_id=None, parent_id=None, milestone_id=None,
        planned_start=None, date_deadline=None, description=_MISSING,
        deliverables=_MISSING, **_,
    ):
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        if project_id is None:
            raise ApiError(422, 'invalid', "project_id is required", field='project_id')
        project_id = parse_positive_int(project_id, 'project_id')
        project = get_record('project.project', project_id)
        request.env['webvue.access.service']._webvue_require_capability('pmo.tasks.create', record=project)
        vals = {'name': name.strip(), 'project_id': project.id, 'user_ids': [(4, request.env.uid)]}
        if description is not _MISSING:
            vals['description'] = _parse_description(description)
        if deliverables is not _MISSING:
            vals['webvue_deliverables'] = _parse_deliverables(deliverables)
        if parent_id is not None:
            parent_id = parse_positive_int(parent_id, 'parent_id')
            vals['parent_id'] = get_record('project.task', parent_id).id
        if milestone_id is not None:
            milestone_id = parse_positive_int(milestone_id, 'milestone_id')
            milestone = request.env['project.milestone'].sudo().browse(milestone_id).exists()
            if not milestone or milestone.project_id.id != project.id:
                raise ApiError(422, 'invalid', "milestone_id must belong to the project's milestones", field='milestone_id')
            vals['milestone_id'] = milestone.id

        schedule_start = parse_date(planned_start, 'planned_start') if planned_start is not None else False
        schedule_end = _parse_deadline(date_deadline, 'date_deadline') if date_deadline is not None else False
        if planned_start is not None:
            if not schedule_start:
                raise ApiError(422, 'invalid', "planned_start must be a YYYY-MM-DD date", field='planned_start')
            if not schedule_end:
                raise ApiError(422, 'invalid', "planned_start requires date_deadline", field='date_deadline')
            if not project._webvue_can_manage():
                raise AccessError(request.env._("Only the project manager can change task scheduling."))
        elif date_deadline is not None:
            vals['date_deadline'] = schedule_end
        task = request.env['project.task'].create(vals)
        if planned_start is not None:
            task._webvue_set_schedule(schedule_start, schedule_end.date())
        return request.make_json_response(dump_task_detail(task), status=201)

    @http.route('/api/v1/tasks/<int:task_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_task(self, task_id, **payload):
        payload.pop('task_id', None)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        task = get_record('project.task', task_id)
        if not task._webvue_can_write():
            raise AccessError(request.env._("You are not allowed to change this task."))
        vals = parse_task_vals(payload, can_manage=task._webvue_can_approve(), task=task)
        task.write(vals)
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/transition', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def transition_task(self, task_id, state=None, **_):
        if state not in API_TO_STATE:
            raise ApiError(422, 'invalid_state', f"unknown state {state!r}", field='state')
        task = get_record('project.task', task_id)
        try:
            task._webvue_transition(API_TO_STATE[state])
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def archive_task(self, task_id, **_):
        task = get_record('project.task', task_id)
        task._webvue_archive()  # AccessError → 403 forbidden via api_handler
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/completion/request', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def request_completion(self, task_id, **extra):
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        task = get_record('project.task', task_id)
        try:
            task._webvue_request_completion()
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        except UserError as e:
            raise ApiError(422, 'invalid', str(e)) from e
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/completion/accept', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def accept_completion(self, task_id, revision=None, **extra):
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        task = get_record('project.task', task_id)
        try:
            task._webvue_accept_completion(revision)
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        except UserError as e:
            raise ApiError(422, 'invalid', str(e), field='revision') from e
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/completion/return', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def return_completion(self, task_id, revision=None, note=None, **extra):
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        task = get_record('project.task', task_id)
        try:
            task._webvue_return_completion(revision, note)
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        except UserError as e:
            field = 'note' if not (isinstance(note, str) and note.strip()) else 'revision'
            raise ApiError(422, 'invalid', str(e), field=field) from e
        return dump_task_detail(task)

    @http.route('/api/v1/tasks/<int:task_id>/completion/withdraw', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def withdraw_completion(self, task_id, revision=None, **extra):
        if extra:
            field = sorted(extra)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        task = get_record('project.task', task_id)
        try:
            task._webvue_withdraw_completion(revision)
        except AccessError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        except UserError as e:
            raise ApiError(422, 'invalid', str(e), field='revision') from e
        return dump_task_detail(task)
