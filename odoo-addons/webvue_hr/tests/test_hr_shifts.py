# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase, set_hr_feature

SCHEDULE_KEYS = {'id', 'name', 'tz', 'two_weeks', 'hours_per_week', 'active', 'attendances'}
ATTENDANCE_KEYS = {'dayofweek', 'day_period', 'hour_from', 'hour_to', 'week_type'}
ASSIGNMENT_KEYS = {'id', 'employee', 'schedule', 'date_start', 'date_end'}
MORNING = {'dayofweek': '0', 'day_period': 'morning', 'hour_from': 8, 'hour_to': 12, 'week_type': None}
AFTERNOON = {'dayofweek': '0', 'day_period': 'afternoon', 'hour_from': 13, 'hour_to': 17, 'week_type': None}


@tagged('post_install', '-at_install', 'webvue')
class TestHrShifts(WebVueHrCase):
    """The /api/v1/hr/shifts surface over the OCA employee calendar planning engine."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = new_test_user(
            cls.env, login='hr_shifts_mgr', password='hr_shifts_mgr_pass_123',
            name='Shift Manager', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
            'company_id': cls.company.id,
        }])
        cls.manager_employee = cls.env['hr.employee'].create({
            'name': 'Shift Manager', 'user_id': cls.manager.id, 'company_id': cls.company.id,
        })
        cls.worker = cls.env['hr.employee'].create({
            'name': 'Shift Worker', 'company_id': cls.company.id,
        })
        cls.other_worker = cls.env['hr.employee'].create({
            'name': 'Shift Other Worker', 'company_id': cls.company.id,
        })
        cls.schedule = cls._schedule('Day Shift', cls.company)
        # The engine's own regenerated calendars are never a schedule of this surface.
        cls.auto_schedule = cls.env['resource.calendar'].create({
            'name': 'Auto generated calendar', 'company_id': cls.company.id,
            'tz': 'UTC', 'auto_generate': True,
        })
        # A second company: its schedule and its employee's planning row are invisible here.
        cls.other_company = cls.env['res.company'].create({'name': 'Shift Other Company'})
        cls.other_employee = cls.env['hr.employee'].create({
            'name': 'Other Company Employee', 'company_id': cls.other_company.id,
        })
        cls.other_schedule = cls._schedule('Other Day Shift', cls.other_company)
        cls.other_assignment = cls.env['hr.employee.calendar'].create({
            'employee_id': cls.other_employee.id,
            'calendar_id': cls.other_schedule.id,
            'date_start': date(2026, 11, 1),
        })

    @classmethod
    def _schedule(cls, name, company):
        return cls.env['resource.calendar'].create({
            'name': name,
            'company_id': company.id,
            'tz': 'UTC',
            'attendance_ids': [(0, 0, {'name': '08 - 12', **MORNING})],
        })

    def _as_manager(self):
        self.authenticate('hr_shifts_mgr', 'hr_shifts_mgr_pass_123')

    def _user_with_shifts(self, login, capability_keys):
        """A user whose only HR access is the given capability keys through one custom role.

        A role must carry the dependencies its capabilities declare (webvue.access.role
        _check_definition), so the caller lists them too: hr.shifts.read requires
        hr.employees.read.
        """
        user = new_test_user(
            self.env, login=login, password=f'{login}_pass_123', name=login,
            groups='webvue_core.group_employee',
        )
        role = self.env['webvue.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login,
            'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', 'in', list(capability_keys)),
            ]).ids)],
        })
        self.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.company.id,
        }])
        return user

    def _assignment(self, employee, schedule=None, date_start=None, date_end=None):
        return self.env['hr.employee.calendar'].create({
            'employee_id': employee.id,
            'calendar_id': (schedule or self.schedule).id,
            'date_start': date_start,
            'date_end': date_end,
        })

    # --- schedules -------------------------------------------------------------------

    def test_schedule_crud_and_archive(self):
        self._as_manager()
        created = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': '  Evening Shift  ', 'tz': 'UTC', 'two_weeks': False,
            'attendances': [MORNING],
        })
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(set(body), SCHEDULE_KEYS)
        self.assertEqual(body['name'], 'Evening Shift')
        self.assertEqual(body['tz'], 'UTC')
        self.assertFalse(body['two_weeks'])
        self.assertTrue(body['active'])
        self.assertEqual(body['hours_per_week'], 4.0)
        self.assertEqual(len(body['attendances']), 1)
        self.assertEqual(set(body['attendances'][0]), ATTENDANCE_KEYS)
        self.assertEqual(body['attendances'][0], MORNING)
        schedule_id = body['id']

        detail = self.api('GET', f'/api/v1/hr/shifts/schedules/{schedule_id}')
        self.assertEqual(detail.json(), body)

        listed = self.api('GET', '/api/v1/hr/shifts/schedules').json()
        self.assertIn(schedule_id, {item['id'] for item in listed['items']})
        self.assertGreaterEqual(listed['total'], len(listed['items']))
        all_before = self.api('GET', '/api/v1/hr/shifts/schedules?active=all').json()

        patched = self.api('PATCH', f'/api/v1/hr/shifts/schedules/{schedule_id}', {
            'name': 'Evening Shift B', 'attendances': [AFTERNOON],
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['name'], 'Evening Shift B')
        self.assertEqual(patched.json()['attendances'], [AFTERNOON])

        archived = self.api('POST', f'/api/v1/hr/shifts/schedules/{schedule_id}/archive', {})
        self.assertEqual(archived.status_code, 200, archived.text)
        self.assertFalse(archived.json()['active'])
        after = self.api('GET', '/api/v1/hr/shifts/schedules').json()
        all_after = self.api('GET', '/api/v1/hr/shifts/schedules?active=all').json()
        # Archiving moves the schedule out of the default (active-only) list by exactly one row...
        self.assertEqual(after['total'], listed['total'] - 1)
        self.assertNotIn(schedule_id, {item['id'] for item in after['items']})
        # ...and leaves it in the 'all' list, whose total is unchanged.
        self.assertEqual(all_after['total'], all_before['total'])
        self.assertIn(schedule_id, {item['id'] for item in all_after['items']})

    def test_archive_is_refused_while_an_employee_is_planned(self):
        self._assignment(self.worker)
        self._as_manager()
        refused = self.api('POST', f'/api/v1/hr/shifts/schedules/{self.schedule.id}/archive', {})
        self.assertEqual(refused.status_code, 422, refused.text)
        self.assertEqual(refused.json()['code'], 'invalid')
        self.assertTrue(self.schedule.active)

    def test_schedule_payload_is_validated(self):
        self._as_manager()
        unknown = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC', 'attendances': [MORNING], 'auto_generate': True,
        })
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'auto_generate'))
        no_lines = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC', 'attendances': [],
        })
        self.assertEqual((no_lines.status_code, no_lines.json()['field']), (422, 'attendances'))
        bad_period = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC',
            'attendances': [{**MORNING, 'day_period': 'night'}],
        })
        self.assertEqual((bad_period.status_code, bad_period.json()['field']), (422, 'day_period'))
        bad_hours = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC',
            'attendances': [{**MORNING, 'hour_from': 12, 'hour_to': 8}],
        })
        self.assertEqual((bad_hours.status_code, bad_hours.json()['field']), (422, 'hour_to'))
        two_weeks = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC', 'two_weeks': True, 'attendances': [MORNING],
        })
        self.assertEqual((two_weeks.status_code, two_weeks.json()['field']), (422, 'two_weeks'))
        unknown_tz = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'Mars/Olympus', 'attendances': [MORNING],
        })
        self.assertEqual((unknown_tz.status_code, unknown_tz.json()['field']), (422, 'tz'))
        empty_patch = self.api('PATCH', f'/api/v1/hr/shifts/schedules/{self.schedule.id}', {})
        self.assertEqual(empty_patch.status_code, 422)

    # --- assignments -----------------------------------------------------------------

    def test_assignment_create_list_patch_and_end(self):
        self._as_manager()
        created = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id,
            'schedule_id': self.schedule.id,
            'date_start': '2026-11-01',
            'date_end': '2026-11-30',
        })
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(set(body), ASSIGNMENT_KEYS)
        self.assertEqual(body['employee'], {'id': self.worker.id, 'name': self.worker.name})
        self.assertEqual(body['schedule'], {'id': self.schedule.id, 'name': self.schedule.name})
        self.assertEqual((body['date_start'], body['date_end']), ('2026-11-01', '2026-11-30'))
        assignment_id = body['id']

        open_ended = self._assignment(self.other_worker, date_start=date(2026, 11, 1))
        listed = self.api('GET', f'/api/v1/hr/shifts/assignments?employee_id={self.worker.id}').json()
        self.assertEqual([item['id'] for item in listed['items']], [assignment_id])
        self.assertEqual(listed['total'], 1)
        by_schedule = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?schedule_id={self.schedule.id}',
        ).json()
        self.assertEqual(by_schedule['total'], 2)
        # The planning engine seeds one row per existing employee (hr_data.xml creates the admin
        # employee before hr_employee_calendar_planning installs and its post_init_hook plans that
        # open-ended version), so a company-wide on_date page is never only this test's rows:
        # every coverage assertion is scoped to the employees this test planned.
        on_date = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?employee_id={self.worker.id}&on_date=2026-11-15',
        ).json()
        self.assertEqual([item['id'] for item in on_date['items']], [assignment_id])
        # The row without a date_end stays planned after the closed one has ended.
        open_only = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?employee_id={self.other_worker.id}&on_date=2027-01-15',
        ).json()
        self.assertEqual([item['id'] for item in open_only['items']], [open_ended.id])
        before_start = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?employee_id={self.other_worker.id}&on_date=2026-10-15',
        ).json()
        self.assertEqual(before_start['total'], 0)
        # The company-wide page holds the engine's rows too, and never another company's row.
        company_wide = self.api('GET', '/api/v1/hr/shifts/assignments?on_date=2026-11-15').json()
        self.assertGreaterEqual(company_wide['total'], 2)
        foreign = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?employee_id={self.other_employee.id}',
        ).json()
        self.assertEqual((foreign['items'], foreign['total']), ([], 0))

        patched = self.api('PATCH', f'/api/v1/hr/shifts/assignments/{assignment_id}', {
            'date_end': '2026-11-15',
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['date_end'], '2026-11-15')
        after_end = self.api(
            'GET', f'/api/v1/hr/shifts/assignments?employee_id={self.worker.id}&on_date=2026-11-16',
        ).json()
        self.assertEqual(after_end['total'], 0)
        bad_range = self.api('PATCH', f'/api/v1/hr/shifts/assignments/{assignment_id}', {
            'date_end': '2026-10-01',
        })
        self.assertEqual((bad_range.status_code, bad_range.json()['field']), (422, 'date_end'))

        deleted = self.api('DELETE', f'/api/v1/hr/shifts/assignments/{assignment_id}')
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json(), {'id': assignment_id})
        again = self.api('DELETE', f'/api/v1/hr/shifts/assignments/{assignment_id}')
        self.assertEqual(again.status_code, 404)

    def test_overlapping_assignments_are_refused(self):
        self._assignment(self.worker, date_start=date(2026, 11, 1), date_end=date(2026, 11, 30))
        self._as_manager()
        overlap = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id,
            'schedule_id': self.schedule.id,
            'date_start': '2026-11-15',
            'date_end': '2026-12-15',
        })
        self.assertEqual(overlap.status_code, 422, overlap.text)
        self.assertEqual(overlap.json()['code'], 'invalid')
        adjacent = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id,
            'schedule_id': self.schedule.id,
            'date_start': '2026-12-01',
            'date_end': '2026-12-31',
        })
        self.assertEqual(adjacent.status_code, 200, adjacent.text)

    def test_assignment_payload_is_validated(self):
        self._as_manager()
        unknown = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id, 'schedule_id': self.schedule.id, 'calendar_id': 3,
        })
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'calendar_id'))
        inverted = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id, 'schedule_id': self.schedule.id,
            'date_start': '2026-12-01', 'date_end': '2026-11-01',
        })
        self.assertEqual((inverted.status_code, inverted.json()['field']), (422, 'date_end'))
        foreign = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id, 'schedule_id': self.other_schedule.id,
        })
        self.assertEqual((foreign.status_code, foreign.json()['field']), (422, 'schedule_id'))
        auto = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id, 'schedule_id': self.auto_schedule.id,
        })
        self.assertEqual((auto.status_code, auto.json()['field']), (422, 'schedule_id'))
        self.assertEqual(
            self.api('GET', f'/api/v1/hr/shifts/schedules/{self.auto_schedule.id}').status_code, 404,
        )

    def test_self_decision_is_forbidden(self):
        own = self._assignment(self.manager_employee, date_start=date(2027, 1, 1))
        self._as_manager()
        created = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.manager_employee.id, 'schedule_id': self.schedule.id,
        })
        self.assertEqual((created.status_code, created.json()['code']), (403, 'forbidden'))
        patched = self.api('PATCH', f'/api/v1/hr/shifts/assignments/{own.id}', {
            'date_end': '2027-02-01',
        })
        self.assertEqual((patched.status_code, patched.json()['code']), (403, 'forbidden'))
        deleted = self.api('DELETE', f'/api/v1/hr/shifts/assignments/{own.id}')
        self.assertEqual((deleted.status_code, deleted.json()['code']), (403, 'forbidden'))
        self.assertTrue(own.exists())

    # --- capability, feature and company boundaries ----------------------------------

    def test_capability_gate(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        denied = self.api('GET', '/api/v1/hr/shifts/schedules')
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        denied = self.api('GET', '/api/v1/hr/shifts/assignments')
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))
        denied = self.api('POST', '/api/v1/hr/shifts/schedules', {
            'name': 'X', 'tz': 'UTC', 'attendances': [MORNING],
        })
        self.assertEqual((denied.status_code, denied.json()['code']), (403, 'forbidden'))

        # hr.shifts.read declares hr.employees.read (spec 8.2), and a role must carry the
        # dependency its capability declares, so the fixture grants both.
        reader = self._user_with_shifts('hr_shifts_reader', ('hr.shifts.read', 'hr.employees.read'))
        self.authenticate('hr_shifts_reader', 'hr_shifts_reader_pass_123')
        listed = self.api('GET', '/api/v1/hr/shifts/schedules')
        # Static diagnosis of the reader's 403 could not separate the two possible refusals, so
        # one message carries both discriminators: the capability keys the service resolves for the
        # reader in this company (a missing hr.shifts.read means the capability gate before the
        # handler), and the response body (its text names the model or field when the handler's
        # own ORM read refused). The 200 expectation itself is unchanged.
        self.assertEqual(
            listed.status_code, 200,
            'resolved capabilities=%s body=%s' % (
                sorted(self.env['webvue.access.service']._webvue_capability_keys(
                    reader, company=self.company,
                )),
                listed.text,
            ),
        )
        refused = self.api('POST', '/api/v1/hr/shifts/assignments', {
            'employee_id': self.worker.id, 'schedule_id': self.schedule.id,
        })
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))

    def test_feature_off_closes_every_shifts_route(self):
        self._as_manager()
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/schedules').status_code, 200)
        set_hr_feature(self, 'hr.shifts', False)
        for path in (
            '/api/v1/hr/shifts/schedules',
            '/api/v1/hr/shifts/assignments',
            '/api/v1/hr/shifts/me',
        ):
            res = self.api('GET', path)
            self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'), path)
        for path in ('/api/v1/hr/shifts/schedules', '/api/v1/hr/shifts/assignments'):
            res = self.api('POST', path, {'name': 'X', 'tz': 'UTC', 'attendances': [MORNING]})
            self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'), path)

    def test_another_company_record_is_a_404(self):
        self._as_manager()
        hidden = f'/api/v1/hr/shifts/schedules/{self.other_schedule.id}'
        self.assertEqual(self.api('GET', hidden).status_code, 404)
        self.assertEqual(self.api('PATCH', hidden, {'name': 'Stolen'}).status_code, 404)
        self.assertEqual(self.api('POST', f'{hidden}/archive', {}).status_code, 404)
        assignment = f'/api/v1/hr/shifts/assignments/{self.other_assignment.id}'
        self.assertEqual(self.api('PATCH', assignment, {'date_end': '2027-01-01'}).status_code, 404)
        self.assertEqual(self.api('DELETE', assignment).status_code, 404)
        self.assertEqual(self.api('GET', '/api/v1/hr/shifts/schedules').status_code, 200)
        self.assertNotIn(self.other_schedule.id, {
            item['id'] for item in self.api('GET', '/api/v1/hr/shifts/schedules').json()['items']
        })
        self.assertEqual(self.other_schedule.name, 'Other Day Shift')

    # --- self-service ------------------------------------------------------------------

    def test_me_returns_the_callers_own_assignments(self):
        self._assignment(self.manager_employee, date_start=date(2026, 11, 1))
        self._assignment(self.worker, date_start=date(2026, 11, 1))
        self._as_manager()
        body = self.api('GET', '/api/v1/hr/shifts/me').json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0]['employee']['id'], self.manager_employee.id)
        self.assertEqual(set(body['items'][0]), ASSIGNMENT_KEYS)

    def test_me_without_an_employee_record_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/shifts/me')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'))
        self.assertIsNone(res.json().get('field'))
