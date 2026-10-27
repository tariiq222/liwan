# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/shifts: the WebVue surface over stock resource.calendar and the OCA
hr_employee_calendar_planning engine (spec 6.2).

A schedule is a company-owned, non-auto-generated resource.calendar; an assignment is
one hr.employee.calendar planning row. The engine keeps its own behaviour (overlap
refusal as a backstop, the employee's auto calendar regeneration, the in-use refusal on archive);
this controller checks the WebVue capability, scopes every query to the current
company and serializes the whitelisted shape. Writes run as the caller: the
hr.shifts.manage capability depends on hr.employees.manage, whose group supplies the
engine ACLs.
"""
from datetime import timedelta

from odoo import fields, http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date
from odoo.addons.webvue_hr.serializers.shifts.hr_shift import (
    dump_assignment,
    dump_schedule,
    parse_assignment_create,
    parse_assignment_patch,
    parse_schedule_create,
    parse_schedule_patch,
)

ACTIVE_VALUES = {'1': True, 'true': True, '0': False, 'false': False, 'all': None}
# The work-time line fields the contract publishes. The engine's work_entry_type_id is
# readable by hr.group_hr_user only, so it is never part of the read.
ATTENDANCE_SOURCE_FIELDS = ('dayofweek', 'day_period', 'hour_from', 'hour_to', 'week_type')


def _parse_active(value):
    """The ``active`` filter: on by default, ``all`` includes the archived schedules."""
    if value is None:
        return True
    if value in ACTIVE_VALUES:
        return ACTIVE_VALUES[value]
    raise ApiError(422, 'invalid', "active must be '0', 'false', '1', 'true' or 'all'", field='active')


def _timezones():
    """Every timezone the engine's Selection field accepts."""
    calendar = request.env['resource.calendar']
    return dict(calendar._fields['tz']._description_selection(calendar.env))


def _attendance_lines(calendars):
    """The work-time lines of these schedules, keyed by schedule id, in the engine's own order.

    The lines are read explicitly with the contract's fields: hr_work_entry guards
    ``resource.calendar.attendance.work_entry_type_id`` with hr.group_hr_user and reads it inside
    the engine's work-time helpers, so a shifts read must not widen the read beyond these fields.
    ``display_type`` (a plain technical field) keeps a two-week calendar's section lines out.
    """
    rows = request.env['resource.calendar.attendance'].search_read(
        [('calendar_id', 'in', calendars.ids), ('display_type', '=', False)],
        ['calendar_id', *ATTENDANCE_SOURCE_FIELDS],
    )
    lines = {}
    for row in rows:
        lines.setdefault(row['calendar_id'][0], []).append(row)
    return lines


def _schedule_body(schedule):
    """One schedule and the work-time lines the contract publishes for it."""
    return dump_schedule(schedule, _attendance_lines(schedule).get(schedule.id, ()))


def _missing(model, record_id):
    raise MissingError(request.env._('%(model)s %(id)s does not exist', model=model, id=record_id))


def _current_schedule(schedule_id):
    """A schedule of the current company, archived ones included."""
    schedule = request.env['resource.calendar'].with_context(active_test=False).search([
        ('id', '=', int(schedule_id)),
        ('company_id', '=', request.env.company.id),
        ('auto_generate', '=', False),
    ], limit=1)
    if not schedule:
        _missing('resource.calendar', schedule_id)
    return schedule


def _assignable_schedule(schedule_id):
    """The schedule an assignment points at: current-company and not auto-generated."""
    schedule = request.env['resource.calendar'].search([
        ('id', '=', schedule_id),
        ('company_id', '=', request.env.company.id),
        ('auto_generate', '=', False),
    ], limit=1)
    if not schedule:
        raise ApiError(
            422, 'invalid', 'schedule_id is not an available work schedule', field='schedule_id',
        )
    return schedule


def _current_employee(employee_id):
    """The employee an assignment points at: current-company and active."""
    employee = request.env['hr.employee'].search([
        ('id', '=', employee_id),
        ('company_id', '=', request.env.company.id),
        ('active', '=', True),
    ], limit=1)
    if not employee:
        raise ApiError(
            422, 'invalid', 'employee_id is not an active employee of the current company',
            field='employee_id',
        )
    return employee


def _current_assignment(assignment_id):
    """One planning row of the current company (another company's row is a 404)."""
    row = request.env['hr.employee.calendar'].search([
        ('id', '=', int(assignment_id)),
        ('company_id', '=', request.env.company.id),
    ], limit=1)
    if not row:
        _missing('hr.employee.calendar', assignment_id)
    return row


def _own_employee():
    employee = request.env.user.employee_ids.filtered(
        lambda record: record.company_id == request.env.company,
    )[:1]
    if not employee:
        raise ApiError(422, 'invalid', 'the current user has no employee record in this company')
    return employee


def _reject_self_assignment(employee):
    """Self-decision: nobody plans their own shifts."""
    if employee in request.env.user.employee_ids:
        raise ApiError(403, 'forbidden', 'an assignment of the caller cannot be planned by the caller')


def _make_room_for(employee, date_start, date_end):
    """Cut the employee's open-ended planning row so a new period fits.

    The engine keeps one non-overlapping planning per employee and gives every employee an
    open-ended default row, so a plain create would always be refused. That row ends the day
    before the new period starts; when the new period has an end, the remainder continues as
    a row of the same calendar. A row with an end date is a planned period and is never cut:
    ``_reject_overlap`` refuses a period that meets it.
    """
    Planning = request.env['hr.employee.calendar']
    open_ended = Planning.search([
        ('employee_id', '=', employee.id),
        ('date_end', '=', False),
        '|', ('date_start', '=', False), ('date_start', '<', date_start),
    ])
    for row in open_ended:
        row.date_end = date_start - timedelta(days=1)
        if date_end:
            Planning.create({
                'employee_id': employee.id,
                'calendar_id': row.calendar_id.id,
                'date_start': date_end + timedelta(days=1),
            })


def _reject_overlap(employee, date_start, date_end, exclude=None):
    """422 ``assignment_overlap`` when the period meets another planning row of the employee."""
    domain = [('employee_id', '=', employee.id)]
    if exclude:
        domain.append(('id', '!=', exclude.id))
    if date_end:
        domain += ['|', ('date_start', '=', False), ('date_start', '<=', date_end)]
    if date_start:
        domain += ['|', ('date_end', '=', False), ('date_end', '>=', date_start)]
    if request.env['hr.employee.calendar'].search_count(domain):
        raise ApiError(
            422, 'assignment_overlap',
            'the employee already has a work schedule assigned in this period',
            field='date_start',
        )


class HrShiftController(http.Controller):

    @http.route('/api/v1/hr/shifts/schedules', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.shifts.read')
    def list_schedules(self, **_):
        args = request.httprequest.args
        active = _parse_active(args.get('active'))
        limit, offset = parse_page(args)
        # active_test stays off: the domain below carries the active filter whenever one is wanted,
        # and 'all' (active None) must not be narrowed back to the active schedules by the ORM.
        schedules = request.env['resource.calendar'].with_context(active_test=False)
        domain = [('company_id', '=', request.env.company.id), ('auto_generate', '=', False)]
        if active is not None:
            domain.append(('active', '=', active))
        total = schedules.search_count(domain)
        records = schedules.search(domain, limit=limit, offset=offset, order='name, id')
        lines = _attendance_lines(records)
        return {
            'items': [dump_schedule(record, lines.get(record.id, ())) for record in records],
            'total': total,
        }

    @http.route('/api/v1/hr/shifts/schedules', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def create_schedule(self, **payload):
        vals = parse_schedule_create(payload, _timezones(), request.env.company.id)
        return _schedule_body(request.env['resource.calendar'].create(vals))

    @http.route('/api/v1/hr/shifts/schedules/<int:schedule_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.shifts.read')
    def get_schedule(self, schedule_id, **_):
        return _schedule_body(_current_schedule(schedule_id))

    @http.route('/api/v1/hr/shifts/schedules/<int:schedule_id>', type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def update_schedule(self, schedule_id, **payload):
        schedule = _current_schedule(schedule_id)
        schedule.write(parse_schedule_patch(payload, _timezones()))
        return _schedule_body(schedule)

    @http.route('/api/v1/hr/shifts/schedules/<int:schedule_id>/archive', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def archive_schedule(self, schedule_id, **payload):
        schedule = _current_schedule(schedule_id)
        if payload:
            field = sorted(payload)[0]
            raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
        # The engine refuses a schedule that is still planned for a current employee (422).
        schedule.write({'active': False})
        return _schedule_body(schedule)

    @http.route('/api/v1/hr/shifts/assignments', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.shifts.read')
    def list_assignments(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('company_id', '=', request.env.company.id)]
        if args.get('employee_id'):
            domain.append(('employee_id', '=', parse_positive_int(args['employee_id'], 'employee_id')))
        if args.get('schedule_id'):
            domain.append(('calendar_id', '=', parse_positive_int(args['schedule_id'], 'schedule_id')))
        if args.get('on_date'):
            on_date = parse_optional_date(args['on_date'], 'on_date')
            # A row covers the date when each open end of its range includes it.
            domain.extend([
                '|', ('date_start', '<=', on_date), ('date_start', '=', False),
                '|', ('date_end', '>=', on_date), ('date_end', '=', False),
            ])
        rows = request.env['hr.employee.calendar']
        total = rows.search_count(domain)
        records = rows.search(domain, limit=limit, offset=offset, order='date_start desc, id desc')
        return {'items': [dump_assignment(record) for record in records], 'total': total}

    @http.route('/api/v1/hr/shifts/assignments', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def create_assignment(self, **payload):
        vals = parse_assignment_create(payload, today=fields.Date.context_today(request.env.user))
        employee = _current_employee(vals['employee_id'])
        schedule = _assignable_schedule(vals['schedule_id'])
        _reject_self_assignment(employee)
        # A refused period leaves the cut rows as they were.
        with request.env.cr.savepoint():
            _make_room_for(employee, vals['date_start'], vals['date_end'])
            _reject_overlap(employee, vals['date_start'], vals['date_end'])
            row = request.env['hr.employee.calendar'].create({
                'employee_id': employee.id,
                'calendar_id': schedule.id,
                'date_start': vals['date_start'],
                'date_end': vals['date_end'] or False,
            })
        return dump_assignment(row)

    @http.route('/api/v1/hr/shifts/assignments/<int:assignment_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.shifts.read')
    def get_assignment(self, assignment_id, **_):
        return dump_assignment(_current_assignment(assignment_id))

    @http.route('/api/v1/hr/shifts/assignments/<int:assignment_id>', type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def update_assignment(self, assignment_id, **payload):
        row = _current_assignment(assignment_id)
        _reject_self_assignment(row.employee_id)
        vals = parse_assignment_patch(payload, row)
        if 'calendar_id' in vals:
            vals['calendar_id'] = _assignable_schedule(vals['calendar_id']).id
        _reject_overlap(
            row.employee_id, vals.get('date_start', row.date_start), vals.get('date_end', row.date_end), exclude=row,
        )
        row.write(vals)
        return dump_assignment(row)

    @http.route('/api/v1/hr/shifts/assignments/<int:assignment_id>', type='json2', auth='user', methods=['DELETE'])
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='write')
    @requires_capability('hr.shifts.manage')
    def delete_assignment(self, assignment_id, **_):
        row = _current_assignment(assignment_id)
        _reject_self_assignment(row.employee_id)
        row.unlink()
        return {'id': int(assignment_id)}

    @http.route('/api/v1/hr/shifts/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.shifts', operation='read')
    @requires_capability('hr.employees.read')
    def my_assignments(self, **_):
        """The caller's own planning rows in the current company."""
        employee = _own_employee()
        limit, offset = parse_page(request.httprequest.args)
        domain = [
            ('company_id', '=', request.env.company.id),
            ('employee_id', '=', employee.id),
        ]
        rows = request.env['hr.employee.calendar']
        total = rows.search_count(domain)
        records = rows.search(domain, limit=limit, offset=offset, order='date_start desc, id desc')
        return {'items': [dump_assignment(record) for record in records], 'total': total}
