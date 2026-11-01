# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.models.project_constants import TASK_CANCELED_STATE
from odoo.addons.liwan_pmo.serializers.project_charter import (
    dump_currency,
    dump_user_ref,
)
from odoo.addons.liwan_pmo.serializers.project_finance import build_finance_summary

BASELINE_WRITE_FIELDS = {'note', 'change_id'}


def _date(value):
    return fields.Date.to_string(value) if value else None


def _days_between(current, planned):
    """Days the current date lies after the baseline date: positive is late, negative early; None when either is missing."""
    if not current or not planned:
        return None
    return (current - planned).days


def dump_baseline(baseline):
    change = baseline.change_id
    return {
        'id': baseline.id,
        'project_id': baseline.project_id.id,
        'number': baseline.number,
        'taken_by': dump_user_ref(baseline.taken_by_id),
        'taken_at': iso(baseline.taken_at),
        'note': baseline.note or '',
        'change': {'id': change.id, 'number': change.number, 'title': change.title} if change else None,
        'budget_total': baseline.budget_total,
        'currency': dump_currency(baseline.currency_id),
        'planned_start': _date(baseline.planned_start),
        'planned_end': _date(baseline.planned_end),
        'task_count': baseline.task_count,
    }


def _readable_lines(baseline):
    """The task lines the caller may read: a task they cannot open stays out (an archived one is still read).

    A line of a deleted task has no live task to hide, so it stays. Without ``pmo.tasks.read`` no line is readable.
    """
    env = baseline.env
    if not env['liwan.access.service']._liwan_has_capability(env.user, 'pmo.tasks.read'):
        return baseline.task_ids.browse()
    lines = baseline.task_ids
    visible = set(env['project.task'].with_context(active_test=False).search([('id', 'in', lines.task_id.ids)]).ids)
    return lines.filtered(lambda line: not line.task_id or line.task_id.id in visible)


def _hidden_count(baseline):
    return baseline.task_count - len(_readable_lines(baseline))


def dump_baseline_detail(baseline):
    return {
        **dump_baseline(baseline),
        'hidden_count': _hidden_count(baseline),
        'tasks': [{
            'id': line.id,
            'task_id': line.task_id.id or None,
            'name': line.task_name,
            'planned_start': _date(line.planned_start),
            'planned_end': _date(line.planned_end),
            'planned_value_share': line.planned_value_share,
        } for line in _readable_lines(baseline)],
    }


def _schedule_row(current_start, current_end, planned_start, planned_end):
    return {
        'baseline_start': _date(planned_start),
        'baseline_end': _date(planned_end),
        'current_start': _date(current_start),
        'current_end': _date(current_end),
        'start_variance_days': _days_between(current_start, planned_start),
        'end_variance_days': _days_between(current_end, planned_end),
    }


def _current_end(task):
    """The task's end as the caller's calendar day, like the overdue logic."""
    return fields.Date.context_today(task, task.date_deadline) if task.date_deadline else None


def _task_status(task, project):
    """``removed`` when the task left the project (deleted, or moved to another one), else ``tracked``."""
    return 'tracked' if task and task.project_id == project else 'removed'


def _plan_tasks_now(project, known_ids):
    """The tasks of the project the baseline does not know: active, not cancelled, readable by the caller."""
    return project.env['project.task'].search([
        ('project_id', '=', project.id), ('active', '=', True), ('state', '!=', TASK_CANCELED_STATE), ('id', 'not in', list(known_ids)),
    ], order='liwan_planned_start asc, date_deadline asc, id asc')


def build_variance(project):
    """Schedule and cost variance of the project against its latest baseline; computed on read, nothing is stored.

    Task rows carry a ``status``: ``tracked`` (in the baseline and still in the project), ``removed`` (in the baseline,
    no longer in the project: deleted or moved away) and ``added`` (in the project, not in the baseline). Only tracked
    rows count as late, early or undated.
    """
    env = project.env
    baseline = env['liwan.project.baseline'].search([('project_id', '=', project.id)], order='number desc', limit=1)
    if not baseline:
        return {'project_id': project.id, 'baseline': None, 'schedule': None, 'cost': None}
    lines = _readable_lines(baseline)
    can_read_tasks = env['liwan.access.service']._liwan_has_capability(env.user, 'pmo.tasks.read')
    tasks = []
    for line in lines:
        task = line.task_id
        status = _task_status(task, project)
        live = status == 'tracked'
        row = _schedule_row(
            task.liwan_planned_start if live else None, _current_end(task) if live else None, line.planned_start, line.planned_end,
        )
        tasks.append({'task_id': task.id or None, 'name': line.task_name, 'status': status, 'archived': bool(task) and not task.active, **row})
    added = _plan_tasks_now(project, baseline.task_ids.task_id.ids) if can_read_tasks else env['project.task']
    tasks += [{
        'task_id': task.id, 'name': task.name, 'status': 'added', 'archived': False,
        **_schedule_row(task.liwan_planned_start, _current_end(task), None, None),
    } for task in added]
    tracked = [row for row in tasks if row['status'] == 'tracked']
    currency = baseline.currency_id
    summary = build_finance_summary(project)
    current_budget = env['liwan.project.baseline']._liwan_current_budget(project)
    return {
        'project_id': project.id,
        'baseline': {'number': baseline.number, 'taken_at': iso(baseline.taken_at)},
        'schedule': {
            'project': _schedule_row(project.date_start, project.date, baseline.planned_start, baseline.planned_end),
            'tasks': tasks,
            'hidden_count': _hidden_count(baseline),
            'late_count': sum(1 for row in tracked if (row['end_variance_days'] or 0) > 0),
            'early_count': sum(1 for row in tracked if (row['end_variance_days'] or 0) < 0),
            'undated_count': sum(1 for row in tracked if row['end_variance_days'] is None),
            'removed_count': sum(1 for row in tasks if row['status'] == 'removed'),
            'added_count': len(added),
        },
        'cost': {
            'currency': dump_currency(currency),
            'baseline_budget': baseline.budget_total,
            'current_budget': current_budget,
            'budget_variance': currency.round(current_budget - baseline.budget_total),
            'actual': summary['actual'],
            'remaining_against_baseline': currency.round(baseline.budget_total - summary['actual']),
            'over_baseline': summary['actual'] > baseline.budget_total,
        },
    }


def parse_baseline_vals(payload):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - BASELINE_WRITE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    vals = {}
    if payload.get('note') is not None:
        if not isinstance(payload['note'], str):
            raise ApiError(422, 'invalid', "note must be a string", field='note')
        vals['note'] = payload['note']
    change_id = payload.get('change_id')
    if change_id is not None:
        if isinstance(change_id, bool) or not isinstance(change_id, int) or change_id <= 0:
            raise ApiError(422, 'invalid', "change_id must be a positive integer", field='change_id')
        vals['change_id'] = change_id
    return vals
