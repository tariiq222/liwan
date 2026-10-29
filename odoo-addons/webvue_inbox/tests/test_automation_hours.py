# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import Command, fields
from odoo.tests import new_test_user, tagged

from .automation_common import BASE, AutomationCase, all_day, hours
from .common import PASSWORD
from odoo.addons.webvue_api.tests.common import set_probe_feature

HOURS = f'{BASE}/working-hours'
# 2026-01-04 is a Sunday (weekday 6).
SUNDAY = {'weekday': 6, 'from': '09:00', 'to': '17:00'}
HOLIDAY = {'name': 'Founding day', 'date_from': '2026-01-04', 'date_to': '2026-01-04'}
STOCK_MODELS = ('resource.calendar', 'resource.calendar.attendance', 'resource.calendar.leaves', 'hr.leave')


@tagged('post_install', '-at_install', 'webvue')
class TestWorkingHoursEngine(AutomationCase):
    """'Inside hours' of the inbox's own rows: weekly ranges, timezone and holidays."""

    def is_open(self, owner, text):
        return self.env['webvue.inbox.working.hours']._webvue_is_open(owner, datetime.strptime(text, '%Y-%m-%d %H:%M'))

    def store(self, data, owner=None):
        owner = owner or self.settings
        self.env['webvue.inbox.working.hours']._webvue_write(owner, data)
        return owner

    def test_no_ranges_means_always_open_even_with_holidays(self):
        self.assertEqual(datetime(2026, 1, 4).weekday(), 6)
        self.assertTrue(self.is_open(self.settings, '2026-01-04 03:00'))
        self.assertTrue(self.is_open(self.store(hours([], holidays=[HOLIDAY])), '2026-01-04 03:00'))

    def test_the_weekly_range_in_its_timezone(self):
        riyadh = self.store(hours([SUNDAY], timezone='Asia/Riyadh'))
        for moment, expected in (
            ('2026-01-04 05:59', False), ('2026-01-04 06:00', True), ('2026-01-04 13:59', True), ('2026-01-04 14:00', False),
            ('2026-01-05 07:00', False),
        ):
            self.assertEqual(self.is_open(riyadh, moment), expected, moment)
        utc = self.store(hours([SUNDAY]))
        self.assertEqual((self.is_open(utc, '2026-01-04 08:59'), self.is_open(utc, '2026-01-04 09:00')), (False, True))

    def test_utc_midnight_is_a_different_weekday_in_riyadh(self):
        # Sunday 22:00 UTC is already Monday 01:00 in Riyadh (UTC+3).
        monday_night = self.store(hours([{'weekday': 0, 'from': '00:00', 'to': '02:00'}], timezone='Asia/Riyadh'))
        self.assertTrue(self.is_open(monday_night, '2026-01-04 22:00'))
        self.assertFalse(self.is_open(monday_night, '2026-01-04 23:00'))
        sunday_utc = self.store(hours([SUNDAY | {'from': '00:00', 'to': '24:00'}]))
        self.assertTrue(self.is_open(sunday_utc, '2026-01-04 23:59'))
        self.assertFalse(self.is_open(sunday_utc, '2026-01-05 00:00'))

    def test_several_ranges_per_day(self):
        owner = self.store(hours([SUNDAY | {'to': '12:00'}, SUNDAY | {'from': '16:00', 'to': '20:00'}]))
        self.assertEqual([self.is_open(owner, f'2026-01-04 {clock}') for clock in ('10:00', '14:00', '17:00', '20:30')],
                         [True, False, True, False])

    def test_a_holiday_closes_its_local_days(self):
        owner = self.store(hours([SUNDAY], timezone='Asia/Riyadh', holidays=[HOLIDAY]))
        self.assertFalse(self.is_open(owner, '2026-01-04 08:00'))
        self.assertTrue(self.is_open(self.store(hours([SUNDAY], timezone='Asia/Riyadh')), '2026-01-04 08:00'))

    def test_a_holiday_spanning_days_follows_the_local_date(self):
        every_day = [all_day(day) for day in range(7)]
        owner = self.store(hours(every_day, timezone='Asia/Riyadh', holidays=[
            {'name': 'Eid', 'date_from': '2026-03-20', 'date_to': '2026-03-22'},
        ]))
        # 21:00 UTC on 19 March is midnight of the 20th in Riyadh; 20:59 UTC on the 22nd is still the 22nd there.
        for moment, expected in (
            ('2026-03-19 20:59', True), ('2026-03-19 21:00', False), ('2026-03-21 12:00', False), ('2026-03-22 20:59', False),
            ('2026-03-22 21:00', True),
        ):
            self.assertEqual(self.is_open(owner, moment), expected, moment)

    def test_the_hours_are_read_back_as_written(self):
        data = hours([SUNDAY | {'to': '12:00'}, {'weekday': 0, 'from': '08:30', 'to': '24:00'}, SUNDAY | {'from': '16:00'}],
                     timezone='Asia/Riyadh', holidays=[
                         {'name': 'Eid', 'date_from': '2026-03-20', 'date_to': '2026-03-23'}, HOLIDAY])
        dumped = self.env['webvue.inbox.working.hours']._webvue_dump(self.store(data))
        self.assertEqual(dumped['timezone'], 'Asia/Riyadh')
        self.assertEqual(dumped['days'], [
            {'weekday': 0, 'from': '08:30', 'to': '24:00'}, SUNDAY | {'to': '12:00'}, SUNDAY | {'from': '16:00'},
        ])
        self.assertEqual(dumped['holidays'], [HOLIDAY, {'name': 'Eid', 'date_from': '2026-03-20', 'date_to': '2026-03-23'}])

    def test_a_department_follows_the_company_until_it_has_hours_of_its_own(self):
        self.store(hours([all_day(6)]))
        self.assertTrue(self.settings._webvue_is_open(datetime(2026, 1, 4, 3), self.department))
        self.store(hours([SUNDAY], timezone='Asia/Riyadh'), self.department)
        self.assertTrue(self.department.hours_own)
        self.assertFalse(self.settings._webvue_is_open(datetime(2026, 1, 4, 3), self.department))
        self.assertTrue(self.settings._webvue_is_open(datetime(2026, 1, 4, 3), self.other_department))
        self.env['webvue.inbox.working.hours']._webvue_clear(self.department)
        self.assertEqual((self.department.hours_own, len(self.department.hours_range_ids)), (False, 0))
        self.assertTrue(self.settings._webvue_is_open(datetime(2026, 1, 4, 3), self.department))

    def test_saving_hours_touches_no_stock_calendar_or_time_off_row(self):
        counts = {model: self.env[model].with_context(active_test=False).search_count([]) for model in STOCK_MODELS if model in self.env}
        self.store(hours([SUNDAY], timezone='Asia/Riyadh', holidays=[HOLIDAY]))
        self.store(hours([SUNDAY], holidays=[HOLIDAY]), self.department)
        self.env['webvue.inbox.working.hours']._webvue_clear(self.department)
        self.assertEqual({model: self.env[model].with_context(active_test=False).search_count([]) for model in counts}, counts)


@tagged('post_install', '-at_install', 'webvue')
class TestWorkingHoursApi(AutomationCase):

    def setUp(self):
        super().setUp()
        self.login(self.automation_user)

    def test_defaults_to_always_open(self):
        self.assertEqual(self.get(HOURS).json(), {'timezone': 'Asia/Riyadh', 'days': [], 'holidays': []})

    def test_put_replaces_the_hours_in_place(self):
        data = hours([SUNDAY, all_day(0)], timezone='Asia/Riyadh', holidays=[HOLIDAY])
        result = self.api('PUT', HOURS, data)
        self.assertEqual((result.status_code, set(result.json())), (200, {'timezone', 'days', 'holidays'}), result.text)
        self.assertEqual(result.json()['days'], [all_day(0), SUNDAY])
        self.assertEqual(self.get(HOURS).json(), result.json())
        again = self.api('PUT', HOURS, hours([SUNDAY], timezone='UTC'))
        self.assertEqual((again.json()['days'], again.json()['holidays'], again.json()['timezone']), ([SUNDAY], [], 'UTC'))
        settings = self.reload(self.settings)
        self.assertEqual((len(settings.hours_range_ids), len(settings.holiday_ids)), (1, 0))
        self.assertEqual(settings.hours_range_ids.company_id, self.env.company)

    def test_saving_through_the_api_touches_no_stock_row(self):
        counts = {model: self.env[model].with_context(active_test=False).search_count([]) for model in STOCK_MODELS if model in self.env}
        self.api('PUT', HOURS, hours([SUNDAY], holidays=[HOLIDAY]))
        self.api('PUT', f'{BASE}/departments/{self.department.id}/working-hours', {'working_hours': hours([SUNDAY])})
        self.assertEqual({model: self.env[model].with_context(active_test=False).search_count([]) for model in counts}, counts)

    def test_invalid_hours_are_rejected(self):
        valid = hours([SUNDAY])
        for bad in (
            {**valid, 'timezone': 'Mars/Base'}, {**valid, 'timezone': '../etc'}, {**valid, 'timezone': ''}, {**valid, 'extra': 1},
            {'timezone': 'UTC', 'days': []}, hours([SUNDAY | {'weekday': 7}]), hours([SUNDAY | {'weekday': True}]),
            hours([SUNDAY | {'from': '17:00', 'to': '09:00'}]), hours([SUNDAY | {'from': '09:00', 'to': '09:00'}]),
            hours([SUNDAY | {'from': '9:00'}]), hours([SUNDAY | {'to': '24:30'}]), hours([SUNDAY | {'x': 1}]),
            hours([SUNDAY, SUNDAY | {'from': '16:00'}]),
            hours([SUNDAY], holidays=[HOLIDAY | {'date_to': '2026-01-03'}]), hours([SUNDAY], holidays=[HOLIDAY | {'date_from': '04/01/2026'}]),
            hours([SUNDAY], holidays=[HOLIDAY | {'name': ''}]), hours([SUNDAY] * 43), hours(holidays=[HOLIDAY] * 101),
            {},
        ):
            self.assertError(self.api('PUT', HOURS, bad), 422, 'invalid')
        self.assertFalse(self.reload(self.settings).hours_range_ids)

    def test_touching_ranges_are_accepted(self):
        result = self.api('PUT', HOURS, hours([SUNDAY | {'to': '12:00'}, SUNDAY | {'from': '12:00'}]))
        self.assertEqual(result.status_code, 200, result.text)

    def test_department_hours_follow_the_company_until_set(self):
        path = f'{BASE}/departments/{self.department.id}/working-hours'
        self.assertEqual(self.get(path).json(), {'working_hours': None})
        data = hours([SUNDAY], timezone='Asia/Riyadh')
        result = self.api('PUT', path, {'working_hours': data})
        self.assertEqual((result.status_code, result.json()), (200, {'working_hours': {**data, 'holidays': []}}), result.text)
        self.assertEqual(self.get(path).json(), result.json())
        cleared = self.api('PUT', path, {'working_hours': None})
        self.assertEqual((cleared.status_code, cleared.json()), (200, {'working_hours': None}))
        department = self.reload(self.department)
        self.assertEqual((department.hours_own, len(department.hours_range_ids)), (False, 0))
        for bad in ({}, {'working_hours': hours([SUNDAY | {'from': '10:00', 'to': '09:00'}])}, {'working_hours': None, 'x': 1}):
            self.assertError(self.api('PUT', path, bad), 422, 'invalid')

    def test_the_department_override_replaces_the_company_hours_for_its_conversations(self):
        self.set_company_hours(self.open_hours_now())
        self.api('PUT', f'{BASE}/departments/{self.department.id}/working-hours', {'working_hours': self.closed_hours_now()})
        settings, department = self.reload(self.settings), self.reload(self.department)
        now = fields.Datetime.now()
        self.assertTrue(settings._webvue_is_open(now))
        self.assertFalse(settings._webvue_is_open(now, department))
        self.assertTrue(settings._webvue_is_open(now, self.other_department))


@tagged('post_install', '-at_install', 'webvue')
class TestWorkingHoursAccess(AutomationCase):

    def routes(self):
        path = f'{BASE}/departments/{self.department.id}/working-hours'
        return (
            ('GET', HOURS, None), ('PUT', HOURS, hours()), ('GET', path, None), ('PUT', path, {'working_hours': None}),
        )

    def test_only_the_automation_capability_opens_the_routes(self):
        for user in (self.agent, self.supervisor, self.reader_only, self.outsider):
            self.login(user)
            for method, path, body in self.routes():
                self.assertError(self.api(method, path, body), 403, 'forbidden')
        for user in (self.automation_user, self.manager):
            self.login(user)
            for method, path, body in self.routes():
                self.assertEqual(self.api(method, path, body).status_code, 200, (user.login, method, path))

    def test_the_automation_capability_alone_does_not_reach_settings_or_conversations(self):
        self.login(self.automation_user)
        self.assertError(self.get('/api/v1/settings/inbox'), 403, 'forbidden')
        self.assertError(self.get('/api/v1/inbox/conversations'), 403, 'forbidden')
        self.assertError(self.get(f'{BASE}/channels'), 403, 'forbidden')

    def test_the_feature_closes_the_routes(self):
        self.login(self.manager)
        set_probe_feature(self, key='inbox.automation', enabled=False)
        for method, path, body in self.routes():
            self.assertError(self.api(method, path, body), 403, 'feature_not_included')


@tagged('post_install', '-at_install', 'webvue')
class TestWorkingHoursCompanyScope(AutomationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.child = cls.env['res.company'].create({'name': 'Hours child company', 'parent_id': cls.env.company.id})
        cls.child_department = cls.env['webvue.inbox.department'].create({'name': 'Child dept', 'company_id': cls.child.id})
        cls.child_manager = new_test_user(
            cls.env, login='hours_child_manager', password=PASSWORD, name='Child manager', groups='base.group_user',
            company_id=cls.env.company.id, company_ids=[Command.set((cls.env.company | cls.child).ids)],
        )
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.child_manager.id, 'company_id': cls.child.id,
            'role_id': cls.env.ref('webvue_inbox.role_inbox_manager').id,
        })

    def test_another_company_department_is_not_found(self):
        self.login(self.manager)
        path = f'{BASE}/departments/{self.child_department.id}/working-hours'
        for method, body in (('GET', None), ('PUT', {'working_hours': None})):
            self.assertError(self.api(method, path, body), 404, 'not_found')

    def test_the_child_manager_keeps_the_child_hours_apart_from_the_parent(self):
        self.login(self.child_manager)
        path = f'{BASE}/departments/{self.child_department.id}/working-hours'
        result = self.api('PUT', path, {'working_hours': hours([SUNDAY], holidays=[HOLIDAY])})
        self.assertEqual(result.status_code, 200, result.text)
        department = self.reload(self.child_department)
        self.assertEqual((department.hours_range_ids.company_id, department.holiday_ids.company_id), (self.child, self.child))
        self.assertFalse(self.reload(self.settings).hours_range_ids)
