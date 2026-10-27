# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared helpers of the onboarding and offboarding area controllers.

Both areas run the same engine (stock employee activity plans and the stock departure
wizard); only the purpose, the capability keys and the URL prefix differ.
"""
from odoo import Command, fields
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, require_capabilities
from odoo.addons.webvue_hr.serializers.lifecycle.run import run_activities

ONBOARDING = 'onboarding'
OFFBOARDING = 'offboarding'
AREAS = (ONBOARDING, OFFBOARDING)
EMPLOYEE_MODEL = 'hr.employee'


def _can(capability):
    return request.env['webvue.access.service']._webvue_has_capability(request.env.user, capability)


def _require(capability):
    require_capabilities(capability)


def _missing(model, record_id):
    raise MissingError(request.env._(
        '%(model)s %(id)s does not exist', model=model, id=record_id,
    ))


def _employee(employee_id):
    """The employee of the current company; another company's employee is a 404."""
    employee = request.env[EMPLOYEE_MODEL].with_context(active_test=False).search([
        ('id', '=', employee_id),
        ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not employee:
        _missing(EMPLOYEE_MODEL, employee_id)
    return employee


def _is_own_employee(employee):
    """Whether EMPLOYEE is the caller's own employee record: the self-decision case."""
    return bool(employee) and employee in request.env.user.employee_ids


def _reject_self_decision(employee):
    if _is_own_employee(employee):
        raise ApiError(403, 'forbidden', 'the caller cannot decide on their own employee record')


def _purpose_plan(area, plan_id):
    """The plan of AREA: an employee plan of the current company (or a shared one)."""
    plan = request.env['mail.activity.plan'].with_context(active_test=False).search([
        ('id', '=', plan_id),
        ('res_model', '=', EMPLOYEE_MODEL),
        ('hr_purpose', '=', area),
        ('company_id', 'in', [*request.env.companies.ids, False]),
    ], limit=1)
    if not plan:
        _missing('mail.activity.plan', plan_id)
    return plan


def _run(area, run_id):
    """The run of AREA in the current company; another purpose or company is a 404."""
    run = request.env['webvue.hr.plan.run'].search([
        ('id', '=', run_id),
        ('company_id', 'in', request.env.companies.ids),
        ('plan_id.hr_purpose', '=', area),
    ], limit=1)
    if not run:
        _missing('webvue.hr.plan.run', run_id)
    return run


def _run_step(area, run_id, activity_id):
    run = _run(area, run_id)
    activity = run_activities(run).filtered(lambda item: item.id == activity_id)
    if not activity:
        _missing('mail.activity', activity_id)
    return run, activity


def _require_step_decision(area, run, activity):
    """A manager may complete any step; the assignee may complete their own.

    The offboarding area never lets the caller complete a step of their own clearance,
    even as its assignee.
    """
    if _is_own_employee(run.employee_id) and area == OFFBOARDING:
        raise ApiError(403, 'forbidden', 'the caller cannot complete their own clearance')
    if not (_can(f'hr.{area}.manage') or activity.user_id == request.env.user):
        raise ApiError(403, 'forbidden', 'an HR manager or the step assignee must complete a step')


def _launch_run(area, employee, plan, plan_date=None):
    """Launch a stock employee plan and record the run with the activities it added.

    A run without a date starts today: the stock wizard would anchor it 30 days after today.
    """
    plan_date = plan_date or fields.Date.context_today(employee)
    Activity = request.env['mail.activity'].with_context(active_test=False)
    domain = [('res_model', '=', EMPLOYEE_MODEL), ('res_id', '=', employee.id)]
    before = set(Activity.search(domain).ids)
    schedule = request.env['mail.activity.schedule'].with_context(
        # active_ids drives the wizard; the company is already pinned by api_handler.
        active_ids=[employee.id],
    ).create({
        'res_model': EMPLOYEE_MODEL,
        # The wizard stores its documents as a serialized id list.
        'res_ids': f'[{employee.id}]',
        'plan_id': plan.id,
        'plan_date': plan_date,
    })
    schedule.action_schedule_plan()
    created = Activity.search(domain).filtered(lambda activity: activity.id not in before)
    return request.env['webvue.hr.plan.run'].create({
        'employee_id': employee.id,
        'plan_id': plan.id,
        'plan_date': plan_date,
        'launched_by_id': request.env.user.id,
        'activity_ids': [Command.set(created.ids)],
    })


def _clearance_runs():
    """{employee id: latest offboarding run} of the current company.

    The latest run is chosen before its state counts: when it is cancelled the employee has
    no clearance until a new run starts, rather than an older checklist's clearance coming back.
    """
    runs = request.env['webvue.hr.plan.run'].search([
        ('company_id', 'in', request.env.companies.ids),
        ('plan_id.hr_purpose', '=', OFFBOARDING),
    ], order='plan_date desc, id desc')
    latest = {}
    for run in runs:
        latest.setdefault(run.employee_id.id, run)
    return {employee_id: run for employee_id, run in latest.items() if run.state == 'open'}
