# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import LiwanMeetingsCase

SETTINGS = '/api/v1/meetings/settings'
SERIES = {
    'name': 'Weekly cadence', 'recurrence': 'weekly', 'until_count': 3,
    'start_datetime': '2026-09-08 09:00:00', 'end_datetime': '2026-09-08 10:00:00',
}


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingScheduleSetting(LiwanMeetingsCase):
    """Owner decision of issue #162 (MTG-20): who may schedule is a per-company setting, with a meeting organizer role."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Assignment = cls.env['liwan.access.assignment']
        company = cls.env.company
        # `employee` keeps only the built-in read grant: the plain employee of the product.
        Assignment.create({'user_id': cls.employee.id, 'company_id': company.id, 'role_id': cls.env.ref('liwan_core.role_employee').id})
        Assignment.create({'user_id': cls.manager.id, 'company_id': company.id, 'role_id': cls.env.ref('liwan_core.role_system_admin').id})
        cls.planner = new_test_user(cls.env, login='api_org', password='api_org_pass_123', name='Omar', groups='liwan_core.group_employee')
        Assignment.create({'user_id': cls.planner.id, 'company_id': company.id, 'role_id': cls.env.ref('liwan_meetings.role_meetings_organizer').id})
        cls.Settings = cls.env['liwan.meeting.settings']

    def _set_policy(self, policy):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        current = self.api('GET', SETTINGS).json()
        response = self.api('PATCH', SETTINGS, {'revision': current['revision'], 'values': {'schedule_policy': policy}})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _schedule(self, login, password):
        self.authenticate(login, password)
        meeting = self.api('POST', '/api/v1/meetings', {'name': 'Planning'})
        series = self.api('POST', '/api/v1/meeting-series', SERIES)
        return meeting, series

    def test_the_default_keeps_todays_behavior_and_is_stated(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', SETTINGS).json()
        self.assertEqual(body, {
            'values': {'schedule_policy': 'organizers_only'},
            'defaults': {'schedule_policy': 'organizers_only'},
            'options': {'schedule_policy': ['all_employees', 'organizers_only']},
            'revision': 0,
        })
        self.assertFalse(self.Settings.search([]))

    def test_the_setting_needs_the_settings_capability(self):
        for login, password in (('api_emp', 'api_emp_pass_123'), ('api_org', 'api_org_pass_123')):
            self.authenticate(login, password)
            self.assertEqual(self.api('GET', SETTINGS).status_code, 403, login)
            denied = self.api('PATCH', SETTINGS, {'revision': 0, 'values': {'schedule_policy': 'all_employees'}})
            self.assertEqual(denied.status_code, 403, login)
        self.assertFalse(self.Settings.search([]))

    def test_the_setting_is_validated_and_guarded_by_its_revision(self):
        saved = self._set_policy('all_employees')
        self.assertEqual((saved['values']['schedule_policy'], saved['revision']), ('all_employees', 1))
        stale = self.api('PATCH', SETTINGS, {'revision': 0, 'values': {'schedule_policy': 'organizers_only'}})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        invalid = self.api('PATCH', SETTINGS, {'revision': 1, 'values': {'schedule_policy': 'everyone'}})
        self.assertEqual((invalid.status_code, invalid.json()['field']), (422, 'schedule_policy'))
        unknown = self.api('PATCH', SETTINGS, {'revision': 1, 'values': {'other': 1}})
        self.assertEqual((unknown.status_code, unknown.json()['field']), (422, 'other'))
        missing = self.api('PATCH', SETTINGS, {'revision': 1})
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'values'))
        self.assertEqual(self.api('GET', SETTINGS).json()['values']['schedule_policy'], 'all_employees')

    def test_only_organizers_may_schedule_by_default(self):
        meeting, series = self._schedule('api_emp', 'api_emp_pass_123')
        self.assertEqual((meeting.status_code, series.status_code), (403, 403), (meeting.text, series.text))
        meeting, series = self._schedule('api_org', 'api_org_pass_123')
        self.assertEqual((meeting.status_code, series.status_code), (201, 201), (meeting.text, series.text))
        generated = self.env['liwan.meeting.minute'].search([('series_id', '=', series.json()['id'])])
        self.assertEqual(generated.organizer_id, self.planner)

    def test_every_employee_may_schedule_when_the_company_chooses_so(self):
        self._set_policy('all_employees')
        meeting, series = self._schedule('api_emp', 'api_emp_pass_123')
        self.assertEqual((meeting.status_code, series.status_code), (201, 201), (meeting.text, series.text))
        generated = self.env['liwan.meeting.minute'].search([('series_id', '=', series.json()['id'])])
        self.assertEqual(len(generated), 3)
        self.assertEqual(generated.organizer_id, self.employee)
        occurrence = self.api('POST', f"/api/v1/meeting-series/{series.json()['id']}/occurrences", {})
        self.assertEqual(occurrence.status_code, 201, occurrence.text)

    def test_choosing_organizers_only_again_closes_scheduling_to_employees(self):
        self._set_policy('all_employees')
        self.assertEqual(self._schedule('api_emp', 'api_emp_pass_123')[0].status_code, 201)
        self._set_policy('organizers_only')
        meeting, series = self._schedule('api_emp', 'api_emp_pass_123')
        self.assertEqual((meeting.status_code, series.status_code), (403, 403))
        self.assertEqual(self._schedule('api_org', 'api_org_pass_123')[0].status_code, 201)

    def test_the_identity_of_an_employee_follows_the_setting(self):
        service = self.env['liwan.access.service']
        self.assertNotIn('meetings.create', service._liwan_identity(self.employee)['capabilities'])
        self._set_policy('all_employees')
        self.assertIn('meetings.create', service._liwan_identity(self.employee)['capabilities'])
        self.assertNotIn('meetings.manage', service._liwan_identity(self.employee)['capabilities'])

    def test_the_policy_belongs_to_one_company(self):
        other = self.env['res.company'].create({'name': 'Other Scheduling Co'})
        self._set_policy('all_employees')
        self.assertEqual(self.Settings._liwan_schedule_policy(self.env.company), 'all_employees')
        self.assertEqual(self.Settings._liwan_schedule_policy(other), 'organizers_only')

    def test_the_organizer_role_is_a_built_in_assignable_role_with_read_and_create(self):
        role = self.env.ref('liwan_meetings.role_meetings_organizer')
        self.assertEqual((role.key, role.type, role.protected, role.assignable), ('meetings_organizer', 'built_in', True, True))
        self.assertEqual(role.name_ar, 'منظّم الاجتماعات')
        self.assertEqual(set(role.permission_ids.mapped('key')), {'meetings.read', 'meetings.create'})
        capabilities = self.env['liwan.access.service']._liwan_identity(self.planner)['capabilities']
        self.assertIn('meetings.create', capabilities)
        self.assertNotIn('meetings.manage', capabilities)
