# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/shifts/roster and /api/v1/hr/shifts/me/week: the weekly shift table.

Reads the planning rows the assignments routes write. A manager sets a whole week for one
employee by assigning a schedule to the seven days; the employee reads their own week.
"""
from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.shifts.hr_shifts import (
    assignable_schedule,
    attendance_lines,
    current_employee,
    own_employee,
    reject_self_assignment,
)
from odoo.addons.liwan_hr.serializers.shifts.hr_roster import (
    WEEK_DAYS,
    dump_roster_employee,
    parse_week_set,
    parse_week_start,
)
from odoo.addons.liwan_hr.serializers.shifts.hr_shift import dump_assignment


def _week_start_arg():
    return parse_week_start(
        request.httprequest.args.get('week_start'), fields.Date.context_today(request.env.user),
    )


def _week_rows(employees, week_start):
    """Planning rows of these employees that meet the week, grouped by employee id."""
    week_end = week_start + timedelta(days=WEEK_DAYS - 1)
    rows = request.env['hr.employee.calendar'].search([
        ('employee_id', 'in', employees.ids),
        ('company_id', '=', request.env.company.id),
        '|', ('date_start', '=', False), ('date_start', '<=', week_end),
        '|', ('date_end', '=', False), ('date_end', '>=', week_start),
    ], order='date_start desc, id desc')
    grouped = {}
    for row in rows:
        grouped.setdefault(row.employee_id.id, request.env['hr.employee.calendar'])
        grouped[row.employee_id.id] |= row
    return rows, grouped


def _dump_week(employees, week_start):
    rows, grouped = _week_rows(employees, week_start)
    lines = attendance_lines(rows.calendar_id)
    empty = request.env['hr.employee.calendar']
    return [
        dump_roster_employee(employee, grouped.get(employee.id, empty), week_start, lines)
        for employee in employees
    ]


def _plan_week(employee, schedule, week_start, week_end):
    """Give the employee ``schedule`` for exactly the week, whatever planning rows meet it.

    A row inside the week goes; a row that starts before it ends the day before; a row that ends
    after it starts the day after; a row that spans the whole week is split around it, the
    remainder keeping the row's calendar. Only then is the week's own row created, so planning
    consecutive weeks (or the week before a planned one) never meets the engine's overlap refusal.
    """
    planning = request.env['hr.employee.calendar']
    meeting = planning.search([
        ('employee_id', '=', employee.id),
        '|', ('date_start', '=', False), ('date_start', '<=', week_end),
        '|', ('date_end', '=', False), ('date_end', '>=', week_start),
    ])
    day_before = week_start - timedelta(days=1)
    day_after = week_end + timedelta(days=1)
    for row in meeting:
        starts_before = not row.date_start or row.date_start < week_start
        ends_after = not row.date_end or row.date_end > week_end
        if starts_before and ends_after:
            remainder = {
                'employee_id': employee.id,
                'calendar_id': row.calendar_id.id,
                'date_start': day_after,
                'date_end': row.date_end or False,
            }
            row.date_end = day_before
            planning.create(remainder)
        elif starts_before:
            row.date_end = day_before
        elif ends_after:
            row.date_start = day_after
        else:
            row.unlink()
    return planning.create({
        'employee_id': employee.id,
        'calendar_id': schedule.id,
        'date_start': week_start,
        'date_end': week_end,
    })


class HrShiftRosterController(http.Controller):

    @http.route('/api/v1/hr/shifts/roster', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.shifts.read')
    def roster(self, **_):
        week_start = _week_start_arg()
        limit, offset = parse_page(request.httprequest.args)
        domain = [('company_id', '=', request.env.company.id), ('active', '=', True)]
        employees = request.env['hr.employee']
        total = employees.search_count(domain)
        page = employees.search(domain, limit=limit, offset=offset, order='name, id')
        return {
            'week_start': fields.Date.to_string(week_start),
            'items': _dump_week(page, week_start),
            'total': total,
        }

    @http.route('/api/v1/hr/shifts/me/week', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.employees.read')
    def my_week(self, **_):
        week_start = _week_start_arg()
        employee = own_employee()
        return {
            'week_start': fields.Date.to_string(week_start),
            **_dump_week(employee, week_start)[0],
        }

    @http.route('/api/v1/hr/shifts/roster/week', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def set_week(self, **payload):
        values = parse_week_set(payload)
        employee = current_employee(values['employee_id'])
        schedule = assignable_schedule(values['schedule_id'])
        reject_self_assignment(employee)
        week_start = values['week_start']
        week_end = week_start + timedelta(days=WEEK_DAYS - 1)
        with request.env.cr.savepoint():
            row = _plan_week(employee, schedule, week_start, week_end)
        return dump_assignment(row)
