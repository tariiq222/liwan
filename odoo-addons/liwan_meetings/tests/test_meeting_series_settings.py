# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo.tests import new_test_user, tagged

from .common import LiwanMeetingsCase


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingSeriesSettings(LiwanMeetingsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_a = cls.env.company
        cls.company_b = cls.env['res.company'].create({
            'name': 'Meeting series settings B',
            'liwan_access_policy_version': 1,
        })
        permission = cls.env['liwan.access.permission']
        reader_role = cls.env['liwan.access.role'].create({
            'name_ar': 'قارئ إعدادات سلاسل الاجتماعات',
            'name_en': 'Meeting series settings reader',
            'key': 'meeting_series_settings_reader',
            'type': 'custom',
            'company_id': cls.company_a.id,
            'permission_ids': [(6, 0, permission.search([
                ('key', '=', 'meetings.read'),
            ]).ids)],
        })
        editor_role = cls.env['liwan.access.role'].create({
            'name_ar': 'محرر إعدادات سلاسل الاجتماعات',
            'name_en': 'Meeting series settings editor',
            'key': 'meeting_series_settings_editor',
            'type': 'custom',
            'company_id': cls.company_a.id,
            'permission_ids': [(6, 0, permission.search([
                ('key', 'in', ['meetings.read', 'meetings.manage', 'meetings.create']),
            ]).ids)],
        })
        cls.env['liwan.access.assignment'].create([
            {'user_id': cls.employee.id, 'role_id': reader_role.id, 'company_id': cls.company_a.id},
            {'user_id': cls.manager.id, 'role_id': editor_role.id, 'company_id': cls.company_a.id},
        ])
        cls.series = cls.env['liwan.meeting.series'].with_company(cls.company_a).create({
            'name': 'Operations review',
            'company_id': cls.company_a.id,
            'recurrence': 'none',
            'organizer_id': cls.manager.id,
            'attendee_ids': [(6, 0, [cls.employee.id])],
            'location': 'Room 1',
            'meeting_url': 'https://meet.example.test/old',
        })

    def _authenticate(self, user='api_mgr'):
        self.authenticate(user, 'api_mgr_pass_123' if user == 'api_mgr' else 'api_emp_pass_123')

    def test_editor_can_patch_only_series_defaults(self):
        self._authenticate()
        response = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {
            'name': 'Operations review updated',
            'location': 'Room 2',
            'meeting_url': 'https://meet.example.test/new',
            'secretary_id': self.employee.id,
            'attendee_ids': [self.employee.id],
        })

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['name'], 'Operations review updated')
        self.assertEqual(body['location'], 'Room 2')
        self.assertEqual(body['meeting_url'], 'https://meet.example.test/new')
        self.assertEqual(body['secretary']['id'], self.employee.id)

    def test_attendee_without_editor_role_cannot_patch_series_defaults(self):
        self._authenticate('api_emp')
        response = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {
            'location': 'Unauthorized room',
        })

        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'forbidden')

    def test_foreign_company_series_is_not_patchable_from_current_company(self):
        foreign_manager = new_test_user(
            self.env,
            login='meeting_series_settings_foreign_manager',
            password='meeting_series_settings_foreign_pass_123',
            groups='liwan_core.group_employee',
            company_id=self.company_b.id,
            company_ids=[self.company_b.id],
        )
        foreign = self.env['liwan.meeting.series'].with_company(self.company_b).create({
            'name': 'Foreign series',
            'company_id': self.company_b.id,
            'recurrence': 'none',
            'organizer_id': foreign_manager.id,
        })
        self._authenticate()
        response = self.api('PATCH', f'/api/v1/meeting-series/{foreign.id}', {
            'location': 'Cross-company edit',
        })

        # Another company's series is not-found, never a 403 that marks it real.
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()['code'], 'not_found')

    def test_patch_rejects_archived_portal_and_foreign_participants(self):
        archived = new_test_user(
            self.env,
            login='meeting_series_settings_archived',
            password='meeting_series_settings_archived_pass_123',
            groups='liwan_core.group_employee',
            company_id=self.company_a.id,
        )
        archived.active = False
        portal = new_test_user(
            self.env,
            login='meeting_series_settings_portal',
            password='meeting_series_settings_portal_pass_123',
            groups='base.group_portal',
            company_id=self.company_a.id,
        )
        self.assertTrue(portal.share)
        foreign = new_test_user(
            self.env,
            login='meeting_series_settings_participant_foreign',
            password='meeting_series_settings_participant_foreign_pass_123',
            groups='liwan_core.group_employee',
            company_id=self.company_b.id,
            company_ids=[self.company_b.id],
        )
        self._authenticate()
        for field, value in (
            ('secretary_id', archived.id),
            ('secretary_id', portal.id),
            ('secretary_id', foreign.id),
            ('attendee_ids', [archived.id]),
            ('attendee_ids', [portal.id]),
            ('attendee_ids', [foreign.id]),
        ):
            response = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {field: value})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['field'], field)

    def test_unknown_recurrence_is_rejected_without_changing_series(self):
        self._authenticate()
        response = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {
            'recurrence': 'weekly',
        })

        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], 'recurrence')
        self.series.invalidate_recordset()
        self.assertEqual(self.series.recurrence, 'none')

    def test_patch_reports_field_specific_name_and_url_errors(self):
        self._authenticate()
        empty_name = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {'name': '  '})
        invalid_url = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {'meeting_url': 'ftp://files.example.test/minutes'})
        self.assertEqual((empty_name.status_code, empty_name.json()['field']), (422, 'name'))
        self.assertEqual((invalid_url.status_code, invalid_url.json()['field']), (422, 'meeting_url'))

    def test_changed_defaults_leave_existing_meetings_and_apply_to_next_occurrence(self):
        series = self.env['liwan.meeting.series'].with_company(self.company_a).create({
            'name': 'Defaults over time',
            'company_id': self.company_a.id,
            'recurrence': 'none',
            'organizer_id': self.manager.id,
            'location': 'Old room',
            'meeting_url': 'https://meet.example.test/old',
        })
        first = series.action_add_occurrence(
            datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'First',
        )
        self._authenticate()
        response = self.api('PATCH', f'/api/v1/meeting-series/{series.id}', {
            'location': 'New room',
            'meeting_url': 'https://meet.example.test/new',
        })
        self.assertEqual(response.status_code, 200, response.text)
        first.invalidate_recordset()
        self.assertEqual(first.location, 'Old room')
        self.assertEqual(first.meeting_url, 'https://meet.example.test/old')

        series.invalidate_recordset()
        second = series.with_user(self.manager).action_add_occurrence(
            datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'Second',
        )
        self.assertEqual(second.location, 'New room')
        self.assertEqual(second.meeting_url, 'https://meet.example.test/new')

    def test_patch_returns_full_detail_shape_and_clears_nullable_secretary(self):
        self.series.write({'secretary_id': self.employee.id})
        self._authenticate()
        response = self.api('PATCH', f'/api/v1/meeting-series/{self.series.id}', {
            'secretary_id': None,
            'attendee_ids': [],
        })

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['id'], self.series.id)
        self.assertIsNone(body['secretary'])
        self.assertEqual(body['attendees'], [])
        self.assertIn('meetings', body)
        self.assertIn('can_edit', body)
