# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/<area>/runs: one launch of an employee plan, and its checklist progress."""
from .fields import date_str, ref
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

RUN_CREATE_FIELDS = {'employee_id', 'plan_id', 'plan_date'}
STEP_DONE_FIELDS = {'feedback'}
CANCEL_FIELDS = {'reason'}


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])


def run_activities(run):
    """The checklist activities of a run, archived (done) ones included, deadline first."""
    return run._webvue_activities().sorted(
        lambda activity: (activity.date_deadline, activity.id),
    )


def _progress(run):
    activities = run_activities(run)
    return activities, len(activities.filtered(lambda activity: activity.state == 'done'))


def run_state(run):
    """The stored cancellation, else the state the checklist derives."""
    if run.state == 'cancelled':
        return 'cancelled'
    return 'done' if run._webvue_is_done() else 'open'


def _cancellation(run):
    if run.state != 'cancelled':
        return None
    return {
        'by': ref(run.cancelled_by_id),
        'on': iso(run.cancelled_on),
        'reason': run.cancel_reason,
    }


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
        'state': run_state(run),
        'cancellation': _cancellation(run),
    }


def dump_run_step(activity, *, manage, caller, cancelled=False):
    return {
        'id': activity.id,
        'summary': activity.summary or '',
        'assignee': ref(activity.user_id),
        'date_deadline': date_str(activity.date_deadline),
        'state': activity.state,
        'date_done': date_str(activity.date_done),
        'can_complete': not cancelled and activity.state != 'done' and (manage or activity.user_id == caller),
    }


def dump_run_detail(run, *, manage, caller):
    summary = dump_run(run)
    return {
        **summary,
        'steps': [
            dump_run_step(activity, manage=manage, caller=caller, cancelled=run.state == 'cancelled')
            for activity in run_activities(run)
        ],
        'can_cancel': manage and summary['state'] == 'open',
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


def parse_run_cancel(payload):
    """Validate a cancellation; the reason is required plain text."""
    _reject_unknown(payload, CANCEL_FIELDS)
    reason = payload.get('reason')
    if not isinstance(reason, str) or not reason.strip():
        raise ApiError(422, 'invalid', 'reason is required', field='reason')
    return {'reason': reason.strip()}
