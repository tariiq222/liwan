# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/<area>/plans: the employee activity plans of onboarding and offboarding.

A plan is a stock ``mail.activity.plan`` of ``hr.employee`` whose ``hr_purpose`` is the
area; its steps are the stock templates, always with the todo activity type. Relation ids
are parsed here and resolved by the controller, like every other HR serializer.
"""
from .fields import ref
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int

PLAN_CREATE_FIELDS = {'name', 'department_id', 'steps'}
PLAN_PATCH_FIELDS = {'name', 'department_id', 'active', 'steps'}
STEP_FIELDS = {
    'summary', 'responsible_type', 'responsible_user_id',
    'delay_count', 'delay_unit', 'delay_from',
}
RESPONSIBLE_TYPES = ('manager', 'coach', 'employee', 'other')
DELAY_UNITS = ('days', 'weeks', 'months')
DELAY_FROM = ('before_plan_date', 'after_plan_date')
# The employee plans of this release always schedule one todo activity per step.
TODO_ACTIVITY_XMLID = 'mail.mail_activity_data_todo'


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])


def dump_step(template):
    return {
        'id': template.id,
        'summary': template.summary or '',
        'responsible_type': template.responsible_type,
        # Only the `other` type names a user; the hr types resolve from the employee.
        'responsible': ref(template.responsible_id) if template.responsible_type == 'other' else None,
        'delay_count': template.delay_count,
        'delay_unit': template.delay_unit,
        'delay_from': template.delay_from,
    }


def dump_plan(plan):
    return {
        'id': plan.id,
        'name': plan.name,
        'department': ref(plan.department_id),
        'active': bool(plan.active),
        'steps': [
            dump_step(template)
            for template in plan.template_ids.sorted(lambda item: (item.sequence, item.id))
        ],
    }


def parse_plan_create(payload):
    """Validate a plan create: a name and at least one step are required."""
    _reject_unknown(payload, PLAN_CREATE_FIELDS)
    vals = {'res_model': 'hr.employee'}
    if 'name' not in payload:
        raise ApiError(422, 'invalid', 'name is required', field='name')
    vals.update(_name_vals(payload))
    vals.update(_department_vals(payload))
    if 'steps' not in payload:
        raise ApiError(422, 'invalid', 'steps is required', field='steps')
    vals['steps'] = _steps_vals(payload.get('steps'))
    return vals


def parse_plan_patch(payload):
    """Validate a plan patch; every listed key is optional, at least one is required."""
    _reject_unknown(payload, PLAN_PATCH_FIELDS)
    vals = {}
    vals.update(_name_vals(payload))
    vals.update(_department_vals(payload))
    if 'active' in payload:
        active = payload.get('active')
        if not isinstance(active, bool):
            raise ApiError(422, 'invalid', 'active must be a boolean', field='active')
        vals['active'] = active
    if 'steps' in payload:
        vals['steps'] = _steps_vals(payload.get('steps'))
    if not vals:
        raise ApiError(422, 'invalid', 'no fields to update')
    return vals


def _name_vals(payload):
    if 'name' not in payload:
        return {}
    name = payload.get('name')
    if not isinstance(name, str) or not name.strip():
        raise ApiError(422, 'invalid', 'name must be a non-empty string', field='name')
    return {'name': name.strip()}


def _department_vals(payload):
    if 'department_id' not in payload:
        return {}
    value = payload.get('department_id')
    if value in (None, False):
        return {'department_id': False}
    return {'department_id': parse_positive_int(value, 'department_id')}


def _steps_vals(steps):
    if not isinstance(steps, list) or not steps:
        raise ApiError(422, 'invalid', 'steps must be a non-empty list', field='steps')
    return [_step_vals(step, index) for index, step in enumerate(steps)]


def _step_vals(step, index):
    field = f'steps[{index}]'
    if not isinstance(step, dict):
        raise ApiError(422, 'invalid', f'{field} must be an object', field=field)
    unknown = sorted(set(step) - STEP_FIELDS)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])
    summary = step.get('summary')
    if not isinstance(summary, str) or not summary.strip():
        raise ApiError(422, 'invalid', 'summary must be a non-empty string', field='summary')
    responsible_type = step.get('responsible_type')
    if responsible_type not in RESPONSIBLE_TYPES:
        raise ApiError(
            422, 'invalid',
            f"responsible_type must be one of {', '.join(RESPONSIBLE_TYPES)}",
            field='responsible_type',
        )
    vals = {
        'summary': summary.strip(),
        'responsible_type': responsible_type,
        'delay_count': _delay_count(step.get('delay_count')),
        'delay_unit': _choice(step.get('delay_unit'), DELAY_UNITS, 'delay_unit'),
        'delay_from': _choice(step.get('delay_from'), DELAY_FROM, 'delay_from'),
    }
    user_id = step.get('responsible_user_id')
    if responsible_type == 'other':
        if user_id in (None, False):
            raise ApiError(
                422, 'invalid',
                'responsible_user_id is required for the other type',
                field='responsible_user_id',
            )
        vals['responsible_id'] = parse_positive_int(user_id, 'responsible_user_id')
    elif user_id not in (None, False):
        raise ApiError(
            422, 'invalid',
            'responsible_user_id is only allowed for the other type',
            field='responsible_user_id',
        )
    return vals


def _delay_count(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ApiError(422, 'invalid', 'delay_count must be a non-negative integer', field='delay_count')
    return value


def _choice(value, allowed, field):
    if value not in allowed:
        raise ApiError(422, 'invalid', f"{field} must be one of {', '.join(allowed)}", field=field)
    return value
