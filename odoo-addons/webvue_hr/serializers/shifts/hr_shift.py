# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/shifts: the WebVue shapes of spec 6.2.

A "schedule" is one company-owned, non-auto-generated ``resource.calendar``; an
"assignment" is one OCA ``hr.employee.calendar`` planning row (a date-ranged calendar
for one employee). Everything an employee's own calendar holds — the auto-generated
calendars, their leaves and the derived work-time rate — stays out of these shapes.
"""
from odoo import Command, fields

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

SCHEDULE_FIELDS = {'name', 'tz', 'two_weeks', 'attendances'}
SCHEDULE_PATCH_FIELDS = {'name', 'tz', 'attendances'}
ATTENDANCE_FIELDS = {'dayofweek', 'day_period', 'hour_from', 'hour_to', 'week_type'}
ASSIGNMENT_FIELDS = {'employee_id', 'schedule_id', 'date_start', 'date_end'}
ASSIGNMENT_PATCH_FIELDS = {'schedule_id', 'date_start', 'date_end'}
DAY_OF_WEEK = ('0', '1', '2', '3', '4', '5', '6')
DAY_PERIODS = ('morning', 'lunch', 'afternoon', 'full_day')
WEEK_TYPES = ('0', '1')
MAX_HOUR = 24


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def _reject_unknown(payload, allowed):
    extra = set(payload) - allowed
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)


def _number(value, field, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(422, 'invalid', f'{field} must be a number', field=field)
    number = float(value)
    if number < 0 or number > maximum:
        raise ApiError(422, 'invalid', f'{field} is outside the supported range', field=field)
    return number


def dump_attendance(line):
    """One work-time line, built from the whitelisted values the controller read.

    ``line`` is the mapping the controller's ``resource.calendar.attendance`` read returned for
    the contract's own fields; the engine's ``work_entry_type_id`` (readable by hr.group_hr_user
    only) is never among them, and a section line of a two-week calendar is excluded by that read.
    """
    return {
        'dayofweek': line['dayofweek'],
        'day_period': line['day_period'],
        'hour_from': line['hour_from'],
        'hour_to': line['hour_to'],
        'week_type': line['week_type'] or None,
    }


def dump_schedule(calendar, attendances):
    """One work schedule with its work-time lines.

    ``hours_per_week`` comes from the engine's persisted mirror (``stored_hours_per_week``),
    never from the derived ``hours_per_week``: the derived field is not stored, so every read
    recomputes it, and that recompute walks ``_get_global_attendances()`` — which hr_work_entry
    narrows with ``attendance.work_entry_type_id``, a field only hr.group_hr_user may read and
    which a shifts reader does not hold. For a non-auto-generated calendar the engine computes
    the derived field from this same mirror, so the published value is unchanged.
    """
    return {
        'id': calendar.id,
        'name': calendar.name,
        'tz': calendar.tz,
        'two_weeks': calendar.two_weeks_calendar,
        'hours_per_week': calendar.stored_hours_per_week or 0.0,
        'active': calendar.active,
        'attendances': [dump_attendance(line) for line in attendances],
    }


def dump_assignment(row):
    return {
        'id': row.id,
        'employee': _ref(row.employee_id),
        'schedule': _ref(row.calendar_id),
        'date_start': fields.Date.to_string(row.date_start) or None,
        'date_end': fields.Date.to_string(row.date_end) or None,
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name is required', field='name')
    return value.strip()


def _parse_tz(value, timezones):
    if not isinstance(value, str) or value not in timezones:
        raise ApiError(422, 'invalid', 'tz is not a known timezone', field='tz')
    return value


def _attendance_vals(payload):
    """One attendance line. ``name`` is required by the engine and is not a contract field,
    so it is derived from the hours; the sequence stays the model default and the model
    order sorts the lines deterministically."""
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', 'attendances entries must be objects', field='attendances')
    _reject_unknown(payload, ATTENDANCE_FIELDS)
    dayofweek = payload.get('dayofweek')
    if dayofweek not in DAY_OF_WEEK:
        raise ApiError(422, 'invalid', 'dayofweek must be a day between 0 and 6', field='dayofweek')
    day_period = payload.get('day_period')
    if day_period not in DAY_PERIODS:
        raise ApiError(422, 'invalid', 'day_period is not a supported period', field='day_period')
    hour_from = _number(payload.get('hour_from'), 'hour_from', MAX_HOUR)
    hour_to = _number(payload.get('hour_to'), 'hour_to', MAX_HOUR)
    if hour_to < hour_from:
        raise ApiError(422, 'invalid', 'hour_to is before hour_from', field='hour_to')
    week_type = payload.get('week_type')
    if week_type is not None and week_type not in WEEK_TYPES:
        raise ApiError(422, 'invalid', 'week_type must be 0, 1 or null', field='week_type')
    return {
        'name': f'{hour_from:g} - {hour_to:g}',
        'dayofweek': dayofweek,
        'day_period': day_period,
        'hour_from': hour_from,
        'hour_to': hour_to,
        'week_type': week_type or False,
    }


def _attendance_commands(value):
    if not isinstance(value, list) or not value:
        raise ApiError(422, 'invalid', 'attendances must be a non-empty list', field='attendances')
    return [Command.create(_attendance_vals(item)) for item in value]


def parse_schedule_create(payload, timezones, company_id):
    """The create body of one work schedule. ``two_weeks`` is fixed false in this release."""
    _reject_unknown(payload, SCHEDULE_FIELDS)
    if payload.get('two_weeks', False) is not False:
        raise ApiError(422, 'invalid', 'two_weeks must be false', field='two_weeks')
    return {
        'name': _parse_name(payload.get('name')),
        'tz': _parse_tz(payload.get('tz'), timezones),
        'company_id': company_id,
        'two_weeks_calendar': False,
        'attendance_ids': _attendance_commands(payload.get('attendances')),
    }


def parse_schedule_patch(payload, timezones):
    """The patch body; ``attendances`` replaces the whole set."""
    _reject_unknown(payload, SCHEDULE_PATCH_FIELDS)
    vals = {}
    if 'name' in payload:
        vals['name'] = _parse_name(payload['name'])
    if 'tz' in payload:
        vals['tz'] = _parse_tz(payload['tz'], timezones)
    if 'attendances' in payload:
        vals['attendance_ids'] = [Command.clear(), *_attendance_commands(payload['attendances'])]
    if not vals:
        raise ApiError(422, 'invalid', 'at least one field is required')
    return vals


def _check_range(date_start, date_end):
    if date_start and date_end and date_end < date_start:
        raise ApiError(422, 'invalid', 'date_end is before date_start', field='date_end')


def parse_assignment_create(payload, today):
    """The create body; an assignment without a start date starts ``today``, like a launched onboarding run."""
    _reject_unknown(payload, ASSIGNMENT_FIELDS)
    date_start = parse_optional_date(payload.get('date_start'), 'date_start') or today
    date_end = parse_optional_date(payload.get('date_end'), 'date_end')
    _check_range(date_start, date_end)
    return {
        'employee_id': parse_positive_int(payload.get('employee_id'), 'employee_id'),
        'schedule_id': parse_positive_int(payload.get('schedule_id'), 'schedule_id'),
        'date_start': date_start,
        'date_end': date_end,
    }


def parse_assignment_patch(payload, row):
    """The patch body against the stored row: the range is checked on the merged values."""
    _reject_unknown(payload, ASSIGNMENT_PATCH_FIELDS)
    vals = {}
    if 'schedule_id' in payload:
        vals['calendar_id'] = parse_positive_int(payload['schedule_id'], 'schedule_id')
    if 'date_start' in payload:
        vals['date_start'] = parse_optional_date(payload['date_start'], 'date_start')
    if 'date_end' in payload:
        vals['date_end'] = parse_optional_date(payload['date_end'], 'date_end')
    if not vals:
        raise ApiError(422, 'invalid', 'at least one field is required')
    date_start = vals.get('date_start', row.date_start)
    date_end = vals.get('date_end', row.date_end)
    _check_range(date_start, date_end)
    return vals
