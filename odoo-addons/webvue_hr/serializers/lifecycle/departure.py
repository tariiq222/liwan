# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/offboarding/departures: the departure record of an employee.

The departure lives on the stock ``hr.version`` fields of the employee; the clearance is
the latest offboarding plan run of that employee.
"""
from .fields import date_str, plain_text, ref
from .run import run_activities
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

DEPARTURE_CREATE_FIELDS = {
    'employee_id', 'departure_date', 'departure_reason_id', 'description',
    'set_contract_end', 'plan_id',
}
DEPARTURE_PATCH_FIELDS = {'departure_date', 'departure_reason_id', 'description'}
CLEARED_CHOICES = {'true': True, 'false': False}


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ApiError(422, 'invalid', f'unknown field: {unknown[0]}', field=unknown[0])


def dump_clearance(run):
    if not run:
        return {'run_id': None, 'done': 0, 'total': 0}
    activities = run_activities(run)
    return {
        'run_id': run.id,
        'done': len(activities.filtered(lambda activity: activity.state == 'done')),
        'total': len(activities),
    }


def dump_departure(employee, clearance_run):
    return {
        'employee': ref(employee),
        'active': bool(employee.active),
        'departure_date': date_str(employee.departure_date),
        'reason': ref(employee.departure_reason_id),
        'description': plain_text(employee.departure_description),
        'clearance': dump_clearance(clearance_run),
    }


def clearance_done(run):
    """Whether every step of RUN is complete; a run without steps is not cleared."""
    if not run:
        return False
    activities = run_activities(run)
    return bool(activities) and all(activity.state == 'done' for activity in activities)


def parse_departure_create(payload):
    """Validate a departure registration: employee, date and reason are required."""
    _reject_unknown(payload, DEPARTURE_CREATE_FIELDS)
    description = payload.get('description')
    if description not in (None, False) and not isinstance(description, str):
        raise ApiError(422, 'invalid', 'description must be a string', field='description')
    set_contract_end = payload.get('set_contract_end', True)
    if not isinstance(set_contract_end, bool):
        raise ApiError(422, 'invalid', 'set_contract_end must be a boolean', field='set_contract_end')
    plan_id = payload.get('plan_id')
    return {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'departure_date': _required_date(payload, 'departure_date'),
        'departure_reason_id': parse_positive_int(payload.get('departure_reason_id'), 'departure_reason_id'),
        'description': (description or '').strip(),
        'set_contract_end': set_contract_end,
        'plan_id': parse_positive_int(plan_id, 'plan_id') if plan_id not in (None, False) else None,
    }


def parse_departure_patch(payload):
    """Validate a departure patch; every listed key is optional, at least one is required."""
    _reject_unknown(payload, DEPARTURE_PATCH_FIELDS)
    vals = {}
    if 'departure_date' in payload:
        vals['departure_date'] = _required_date(payload, 'departure_date')
    if 'departure_reason_id' in payload:
        vals['departure_reason_id'] = parse_positive_int(
            payload.get('departure_reason_id'), 'departure_reason_id',
        )
    if 'description' in payload:
        description = payload.get('description')
        if description not in (None, False) and not isinstance(description, str):
            raise ApiError(422, 'invalid', 'description must be a string', field='description')
        vals['departure_description'] = (description or '').strip()
    if not vals:
        raise ApiError(422, 'invalid', 'no fields to update')
    return vals


def parse_cleared(value):
    """The ``cleared`` query filter: None when absent, else the expected clearance state."""
    if value in (None, ''):
        return None
    if value not in CLEARED_CHOICES:
        raise ApiError(422, 'invalid', 'cleared must be true or false', field='cleared')
    return CLEARED_CHOICES[value]


def _required_date(payload, field):
    value = parse_optional_date(payload.get(field), field)
    if not value:
        raise ApiError(422, 'invalid', f'{field} must be a YYYY-MM-DD date', field=field)
    return value
