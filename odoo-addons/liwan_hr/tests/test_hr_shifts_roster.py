# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import new_test_user, tagged

from .common import LiwanHrCase, set_hr_feature

MONDAY = date(2026, 11, 2)
MONDAY_ONLY = {'dayofweek': '0', 'day_period': 'morning', 'hour_from': 8, 'hour_to': 12, 'week_type': False}
TUESDAY_ONLY = {'dayofweek': '1', 'day_period': 'afternoon', 'hour_from': 13, 'hour_to': 17, 'week_type': False}
DAY_KEYS = {'date', 'schedule', 'shifts'}
SHIFT_KEYS = {'hour_from', 'hour_to', 'day_period'}


@tagged('post_install', '-at_install', 'liwan')
class TestHrShiftsRoster(LiwanHrCase):
    """The weekly shift table: /roster, /roster/week and /me/week over the planning rows."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = new_test_user(
            cls.env, login='hr_roster_mgr', password='hr_roster_mgr_pass_123',
            name='Roster Manager', groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('liwan_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.manager_employee = cls.env['hr.employee'].create({
            'name': 'Roster Manager', 'user_id': cls.manager.id, 'company_id': cls.company.id,
        })
        cls.worker = cls.env['hr.employee'].create({'name': 'Roster Worker', 'company_id': cls.company.id})
        cls.monday_schedule = cls._schedule('Monday Shift', MONDAY_ONLY)
        cls.tuesday_schedule = cls._schedule('Tuesday Shift', TUESDAY_ONLY)
        cls.other_company = cls.env['res.company'].create({'name': 'Roster Other Company'})
        cls.other_employee = cls.env['hr.employee'].create({
            'name': 'Roster Other Employee', 'company_id': cls.other_company.id,
        })

    @classmethod
    def _schedule(cls, name, line):
        return cls.env['resource.calendar'].create({
            'name': name, 'company_id': cls.company.id, 'tz': 'UTC',
            'attendance_ids': [(0, 0, {'name': name, **line})],
        })

    def _as_manager(self):
        self.authenticate('hr_roster_mgr', 'hr_roster_mgr_pass_123')

    def _set_week(self, schedule, employee=None, week_start='2026-11-02'):
        return self.api('POST', '/api/v1/hr/shifts/roster/week', {
            'employee_id': (employee or self.worker).id,
            'schedule_id': schedule.id,
            'week_start': week_start,
        })

    def _row(self, week_start='2026-11-02'):
        body = self.api('GET', f'/api/v1/hr/shifts/roster?week_start={week_start}&limit=200').json()
        return body, next(item for item in body['items'] if item['employee']['id'] == self.worker.id)

    def test_set_week_then_roster_shows_the_schedule_on_each_day(self):
        self._as_manager()
        res = self._set_week(self.monday_schedule)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['date_start'], res.json()['date_end']), ('2026-11-02', '2026-11-08'))
        body, row = self._row()
        self.assertEqual(body['week_start'], '2026-11-02')
        self.assertEqual(len(row['days']), 7)
        for day in row['days']:
            self.assertEqual(set(day), DAY_KEYS)
            self.assertEqual(day['schedule']['id'], self.monday_schedule.id)
        monday, tuesday = row['days'][0], row['days'][1]
        self.assertEqual(monday['date'], '2026-11-02')
        self.assertEqual(len(monday['shifts']), 1)
        self.assertEqual(set(monday['shifts'][0]), SHIFT_KEYS)
        self.assertEqual((monday['shifts'][0]['hour_from'], monday['shifts'][0]['hour_to']), (8, 12))
        self.assertEqual(tuesday['shifts'], [])

    def test_the_week_outside_the_planned_one_keeps_the_default_schedule(self):
        self._as_manager()
        self._set_week(self.monday_schedule)
        _, before = self._row('2026-10-26')
        _, after = self._row('2026-11-09')
        for row in (before, after):
            schedule = row['days'][0]['schedule']
            self.assertTrue(schedule is None or schedule['id'] != self.monday_schedule.id)

    def test_setting_the_same_week_again_replaces_its_schedule(self):
        self._as_manager()
        first = self._set_week(self.monday_schedule).json()
        second = self._set_week(self.tuesday_schedule)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first['date_start'], second.json()['date_start'])
        self.assertEqual(self.env['hr.employee.calendar'].search_count([
            ('employee_id', '=', self.worker.id), ('date_start', '=', MONDAY),
        ]), 1)
        _, row = self._row()
        self.assertEqual({day['schedule']['id'] for day in row['days']}, {self.tuesday_schedule.id})
        self.assertEqual(len(row['days'][1]['shifts']), 1)
        self.assertEqual(row['days'][0]['shifts'], [])

    def test_consecutive_and_earlier_weeks_can_be_planned(self):
        self._as_manager()
        for week_start, schedule in (
            ('2026-11-02', self.monday_schedule),
            ('2026-11-09', self.tuesday_schedule),
            ('2026-10-26', self.tuesday_schedule),
        ):
            res = self._set_week(schedule, week_start=week_start)
            self.assertEqual(res.status_code, 200, (week_start, res.text))
        for week_start, schedule in (
            ('2026-10-26', self.tuesday_schedule),
            ('2026-11-02', self.monday_schedule),
            ('2026-11-09', self.tuesday_schedule),
        ):
            _, row = self._row(week_start)
            self.assertEqual({day['schedule']['id'] for day in row['days']}, {schedule.id}, week_start)

    def test_a_longer_period_is_split_around_the_week(self):
        self.env['hr.employee.calendar'].search([('employee_id', '=', self.worker.id)]).unlink()
        self.env['hr.employee.calendar'].create({
            'employee_id': self.worker.id, 'calendar_id': self.tuesday_schedule.id,
            'date_start': date(2026, 10, 1), 'date_end': date(2026, 12, 31),
        })
        self._as_manager()
        self.assertEqual(self._set_week(self.monday_schedule).status_code, 200)
        _, inside = self._row('2026-11-02')
        _, before = self._row('2026-10-26')
        _, after = self._row('2026-11-09')
        rows = self.env['hr.employee.calendar'].search([('employee_id', '=', self.worker.id)], order='date_start')
        detail = [(r.calendar_id.name, str(r.date_start), str(r.date_end)) for r in rows]
        self.assertEqual({day['schedule']['id'] if day['schedule'] else None for day in inside['days']}, {self.monday_schedule.id}, detail)
        self.assertEqual({day['schedule']['id'] if day['schedule'] else None for day in before['days']}, {self.tuesday_schedule.id}, detail)
        self.assertEqual({day['schedule']['id'] if day['schedule'] else None for day in after['days']}, {self.tuesday_schedule.id}, detail)

    def test_the_manager_cannot_plan_their_own_week(self):
        self._as_manager()
        res = self._set_week(self.monday_schedule, employee=self.manager_employee)
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_my_week_is_the_callers_own(self):
        self.env['hr.employee.calendar'].create({
            'employee_id': self.manager_employee.id, 'calendar_id': self.monday_schedule.id,
            'date_start': MONDAY, 'date_end': date(2026, 11, 8),
        })
        self._as_manager()
        body = self.api('GET', '/api/v1/hr/shifts/me/week?week_start=2026-11-02').json()
        self.assertEqual(body['employee']['id'], self.manager_employee.id)
        self.assertEqual(body['week_start'], '2026-11-02')
        self.assertEqual(len(body['days']), 7)
        self.assertEqual(body['days'][0]['schedule']['id'], self.monday_schedule.id)
        self.assertEqual(len(body['days'][0]['shifts']), 1)

    def test_validation_errors_are_422(self):
        self._as_manager()
        bad = self.api('GET', '/api/v1/hr/shifts/roster?week_start=tomorrow')
        self.assertEqual((bad.status_code, bad.json()['code'], bad.json()['field']), (422, 'invalid', 'week_start'))
        missing = self.api('POST', '/api/v1/hr/shifts/roster/week', {
            'employee_id': self.worker.id, 'schedule_id': self.monday_schedule.id,
        })
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'week_start'))
        extra = self.api('POST', '/api/v1/hr/shifts/roster/week', {
            'employee_id': self.worker.id, 'schedule_id': self.monday_schedule.id,
            'week_start': '2026-11-02', 'note': 'x',
        })
        self.assertEqual((extra.status_code, extra.json()['field']), (422, 'note'))
        foreign = self._set_week(self.monday_schedule, employee=self.other_employee)
        self.assertEqual((foreign.status_code, foreign.json()['field']), (422, 'employee_id'))

    def test_another_company_employee_is_not_in_the_roster(self):
        self._as_manager()
        body = self.api('GET', '/api/v1/hr/shifts/roster?limit=200').json()
        self.assertNotIn(self.other_employee.id, {item['employee']['id'] for item in body['items']})

    def test_reading_needs_the_shifts_capability_and_the_feature(self):
        new_test_user(
            self.env, login='hr_roster_plain', password='hr_roster_plain_pass_123',
            name='Plain', groups='liwan_core.group_employee',
        )
        self.authenticate('hr_roster_plain', 'hr_roster_plain_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/roster').status_code, 403)
        self.assertEqual(self._set_week(self.monday_schedule).status_code, 403)
        self._as_manager()
        set_hr_feature(self, 'hr.shifts', False)
        for method, path in (
            ('GET', '/api/v1/hr/shifts/roster'),
            ('GET', '/api/v1/hr/shifts/me/week'),
        ):
            res = self.api(method, path)
            self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'), path)
