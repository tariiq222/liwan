# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/shifts/roster and /me/week: the week view over the employee calendar planning.

A week is seven consecutive days from a start date. For each employee and day the roster names
the work schedule whose planning row covers the day and the work-time lines of that weekday.
"""
from datetime import date, timedelta

from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.shifts.hr_shift import _ref

WEEK_DAYS = 7
WEEK_PATCH_FIELDS = {'employee_id', 'schedule_id', 'week_start'}


def parse_week_start(value, default):
    """The first day of the requested week, ``default`` when the query leaves it out."""
    if value in (None, ''):
        return default
    if isinstance(value, str) and len(value) == 10:
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ApiError(422, 'invalid', 'week_start must be a YYYY-MM-DD date', field='week_start')


def parse_week_set(payload):
    """The body of a week assignment: who, which schedule, which week."""
    extra = set(payload) - WEEK_PATCH_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    values = {}
    for field in ('employee_id', 'schedule_id'):
        value = payload.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ApiError(422, 'invalid', f'{field} must be a positive integer', field=field)
        values[field] = value
    values['week_start'] = parse_week_start(payload.get('week_start'), None)
    if values['week_start'] is None:
        raise ApiError(422, 'invalid', 'week_start is required', field='week_start')
    return values


def _week_type(day):
    """The engine's alternation of a two-week calendar (``resource.calendar.get_week_type``)."""
    return str((day.toordinal() - 1) // 7 % 2)


def _covering_row(rows, day):
    """The planning row that covers ``day``; the engine keeps one per employee and day."""
    for row in rows:
        if (not row.date_start or row.date_start <= day) and (not row.date_end or row.date_end >= day):
            return row
    return None


def _shifts_of(row, day, lines_by_calendar):
    if not row:
        return []
    weekday = str(day.weekday())
    week_type = _week_type(day)
    return [
        {'hour_from': line['hour_from'], 'hour_to': line['hour_to'], 'day_period': line['day_period']}
        for line in lines_by_calendar.get(row.calendar_id.id, ())
        if line['dayofweek'] == weekday and line['week_type'] in (False, None, week_type)
    ]


def dump_roster_employee(employee, rows, week_start, lines_by_calendar):
    """One employee's seven days; ``rows`` are the employee's planning rows meeting the week."""
    days = []
    for offset in range(WEEK_DAYS):
        day = week_start + timedelta(days=offset)
        row = _covering_row(rows, day)
        days.append({
            'date': fields.Date.to_string(day),
            'schedule': _ref(row.calendar_id) if row else None,
            'shifts': _shifts_of(row, day, lines_by_calendar),
        })
    return {'employee': _ref(employee), 'days': days}
