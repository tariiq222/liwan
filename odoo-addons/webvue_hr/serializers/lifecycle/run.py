# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/<area>/runs: one launch of an employee plan, and its checklist progress."""
from .fields import date_str, ref
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

RUN_CREATE_FIELDS = {'employee_id', 'plan_id', 'plan_date'}
STEP_DONE_FIELDS = {'feedback'}


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])


def run_activities(run):
    """The checklist activities of a run, archived (done) ones included, deadline first."""
    return run.with_context(active_test=False).activity_ids.sorted(
        lambda activity: (activity.date_deadline, activity.id),
    )


def _progress(run):
    activities = run_activities(run)
    return activities, len(activities.filtered(lambda activity: activity.state == 'done'))


def dump_run(run):
    activities, done = _progress(run)
    total = len(activities)
    return {
        'id': run.id,
        'employee': ref(run.employee_id),
        'plan': ref(run.plan_id),
        'plan_date': date_str(run.plan_date),
        'launched_by': ref(run.launched_by_id),
        'done': done,
        'total': total,
        'state': 'done' if total and done == total else 'open',
    }


def dump_run_step(activity, *, manage, caller):
    return {
        'id': activity.id,
        'summary': activity.summary or '',
        'assignee': ref(activity.user_id),
        'date_deadline': date_str(activity.date_deadline),
        'state': activity.state,
        'date_done': date_str(activity.date_done),
        'can_complete': activity.state != 'done' and (manage or activity.user_id == caller),
    }


def dump_run_detail(run, *, manage, caller):
    return {
        **dump_run(run),
        'steps': [
            dump_run_step(activity, manage=manage, caller=caller)
            for activity in run_activities(run)
        ],
    }


def parse_run_create(payload):
    """Validate a run launch; ``plan_date`` is optional and the engine computes it."""
    _reject_unknown(payload, RUN_CREATE_FIELDS)
    vals = {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'plan_id': parse_positive_int(payload.get('plan_id'), 'plan_id'),
    }
    plan_date = parse_optional_date(payload.get('plan_date'), 'plan_date')
    if plan_date:
        vals['plan_date'] = plan_date
    return vals


def parse_step_done(payload):
    """Validate a step completion; the feedback is optional plain text."""
    _reject_unknown(payload, STEP_DONE_FIELDS)
    feedback = payload.get('feedback')
    if feedback in (None, False):
        return {'feedback': ''}
    if not isinstance(feedback, str):
        raise ApiError(422, 'invalid', 'feedback must be a string', field='feedback')
    return {'feedback': feedback.strip()}
