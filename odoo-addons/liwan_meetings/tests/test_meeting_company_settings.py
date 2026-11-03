# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-company meetings settings added for the 2026-10-30 test round: the reminder window and the reference prefix.

The meetings settings row keeps its one-row-per-company contract; the PATCH carries only what the
form changed and every setting is validated with its own field name.
"""
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import LiwanMeetingsCase

SETTINGS = '/api/v1/meetings/settings'
SERIES = {
    'name': 'Daily standup', 'recurrence': 'daily', 'until_count': 3,
    'start_datetime': '2026-09-08 09:00:00', 'end_datetime': '2026-09-08 09:15:00',
}
# The GET body a company that never saved the settings answers.
DEFAULT_SETTINGS = {
    'values': {'schedule_policy': 'organizers_only', 'reminder_hours': 24, 'reference_prefix': 'MIN'},
    'defaults': {'schedule_policy': 'organizers_only', 'reminder_hours': 24, 'reference_prefix': 'MIN'},
    'options': {
        'schedule_policy': ['all_employees', 'organizers_only'],
        'reminder_hours': {'min': 1, 'max': 168},
        'reference_prefix': {'pattern': '[A-Z0-9]{1,10}', 'max_length': 10},
    },
    'revision': 0,
}


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingCompanySettings(LiwanMeetingsCase):
    """ج3 نافذة التذكير and ج4 بادئة المرجع of the owner's 2026-11-02 scope."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Assignment = cls.env['liwan.access.assignment']
        for user, role in ((cls.employee, 'liwan_core.role_employee'), (cls.manager, 'liwan_core.role_system_admin')):
            Assignment.create({'user_id': user.id, 'company_id': cls.env.company.id, 'role_id': cls.env.ref(role).id})
        # The meeting organizer role, assigned like the product does it: the role carries read and create.
        cls.planner = new_test_user(
            cls.env, login='api_settings_org', password='api_org_pass_123', name='Omar',
            groups='liwan_core.group_employee', company_id=cls.env.company.id,
        )
        cls.planner.sudo().write({'liwan_access_managed': True})
        Assignment.create({'user_id': cls.planner.id, 'company_id': cls.env.company.id, 'role_id': cls.env.ref('liwan_meetings.role_meetings_organizer').id})
        cls.Settings = cls.env['liwan.meeting.settings']

    def _settings(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        return self.api('GET', SETTINGS).json()

    def _authenticate_planner(self):
        # The organizer role is assigned to the planner; the group alone is not the identity.
        self.authenticate('api_settings_org', 'api_org_pass_123')

    def _patch(self, values):
        current = self._settings()
        return self.api('PATCH', SETTINGS, {'revision': current['revision'], 'values': values})

    def test_the_defaults_are_stated_in_values_defaults_and_options(self):
        self.assertEqual(self._settings(), DEFAULT_SETTINGS)
        self.assertFalse(self.Settings.search([]))

    def test_the_patch_saves_each_setting_and_keeps_an_omitted_one(self):
        saved = self._patch({'reminder_hours': 48})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['values'], {**DEFAULT_SETTINGS['values'], 'reminder_hours': 48})
        self.assertEqual((saved.json()['revision'], saved.json()['defaults']), (1, DEFAULT_SETTINGS['defaults']))
        prefixed = self._patch({'reference_prefix': 'OPS1'})
        self.assertEqual(prefixed.status_code, 200, prefixed.text)
        self.assertEqual(
            prefixed.json()['values'],
            {'schedule_policy': 'organizers_only', 'reminder_hours': 48, 'reference_prefix': 'OPS1'},
        )
        self.assertEqual(prefixed.json()['revision'], 2)

    def test_out_of_range_values_are_refused_with_their_field(self):
        for settings, value, field in (
            ({'reminder_hours': 0}, 0, 'reminder_hours'),
            ({'reminder_hours': 169}, 169, 'reminder_hours'),
            ({'reminder_hours': '24'}, '24', 'reminder_hours'),
            ({'reminder_hours': 24.5}, 24.5, 'reminder_hours'),
            ({'reference_prefix': ''}, '', 'reference_prefix'),
            ({'reference_prefix': 'min'}, 'min', 'reference_prefix'),
            ({'reference_prefix': 'MIN-1'}, 'MIN-1', 'reference_prefix'),
            ({'reference_prefix': 'ABCDEFGHIJK'}, 'ABCDEFGHIJK', 'reference_prefix'),
            ({'reference_prefix': 5}, 5, 'reference_prefix'),
        ):
            response = self._patch(settings)
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), (value, response.text))
            self.assertEqual(response.json()['field'], field, value)
        self.assertFalse(self.Settings.search([]))

    def test_the_window_bounds_are_accepted(self):
        for hours in (1, 168):
            response = self._patch({'reminder_hours': hours})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['values']['reminder_hours'], hours)

    def test_the_reminder_cron_follows_the_meeting_company_window(self):
        now = fields.Datetime.now()
        Settings = self.Settings.sudo()
        other = self.env['res.company'].create({'name': 'Other Reminder Co'})
        Settings.create({'company_id': self.env.company.id, 'reminder_hours': 2})
        Settings.create({'company_id': other.id, 'reminder_hours': 48})
        far = self.env['liwan.meeting.minute'].create({
            'name': 'Two days ahead', 'reference': 'SEED/1', 'state': 'draft', 'organizer_id': self.planner.id,
            'meeting_date': fields.Date.to_date(now + timedelta(hours=40)),
            'start_datetime': now + timedelta(hours=40), 'end_datetime': now + timedelta(hours=41),
        })
        # A member of both companies organizes the other company's meeting.
        elsewhere = self.planner.sudo()
        elsewhere.company_ids = [(4, other.id)]
        far_other = far.with_company(other).create({
            'name': 'Two days ahead elsewhere', 'reference': 'SEED/2', 'state': 'draft', 'organizer_id': elsewhere.id,
            'meeting_date': fields.Date.to_date(now + timedelta(hours=40)),
            'start_datetime': now + timedelta(hours=40), 'end_datetime': now + timedelta(hours=41),
        })
        short = self.env['liwan.meeting.minute'].create({
            'name': 'One hour ahead', 'state': 'draft', 'organizer_id': self.planner.id,
            'meeting_date': fields.Date.to_date(now + timedelta(hours=1)),
            'start_datetime': now + timedelta(hours=1), 'end_datetime': now + timedelta(hours=2),
        })
        self.assertEqual(self.env.company.liwan_meeting_reminder_hours, 2)
        self.assertEqual(far_other.company_id.liwan_meeting_reminder_hours, 48)
        self.env['liwan.meeting.minute'].sudo()._liwan_run_meeting_reminders()
        reminded = self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', 'meeting_reminder'),
            ('liwan_meeting_id', 'in', (far | far_other | short).ids),
        ]).mapped('liwan_meeting_id')
        self.assertIn(short.id, reminded)
        self.assertIn(far_other.id, reminded)
        self.assertNotIn(far.id, reminded)
        # A company that never saved the settings keeps the 24-hour default.
        spare = self.env['res.company'].create({'name': 'Default Reminder Co'})
        self.assertEqual(spare.liwan_meeting_reminder_hours, 24)

    def test_the_reminder_window_includes_its_exact_boundary(self):
        now = fields.Datetime.to_datetime('2027-06-01 09:00:00')
        self.Settings.create({'company_id': self.env.company.id, 'reminder_hours': 1})
        Meeting = self.env['liwan.meeting.minute']
        boundary = Meeting.create({
            'name': 'Exactly one hour ahead', 'organizer_id': self.planner.id,
            'start_datetime': now + timedelta(hours=1), 'end_datetime': now + timedelta(hours=2),
        })
        outside = Meeting.create({
            'name': 'Outside the reminder window', 'organizer_id': self.manager.id,
            'start_datetime': now + timedelta(hours=1, seconds=1), 'end_datetime': now + timedelta(hours=2, seconds=1),
        })
        domain = [
            ('liwan_notification_kind', '=', 'meeting_reminder'),
            ('liwan_meeting_id', 'in', (boundary | outside).ids),
        ]
        # The shipped cron runs as base.user_root, not as an API fixture's user.
        root = self.env.ref('base.user_root')
        cron = Meeting.with_user(root)
        Message = self.env['mail.message'].with_user(root)
        with patch.object(fields.Datetime, 'now', return_value=now):
            cron._liwan_run_meeting_reminders()
            messages = Message.search(domain)
            self.assertTrue(messages, 'The cron must deliver at the exact one-hour cutoff')
            self.assertEqual(messages.mapped('liwan_meeting_id').ids, boundary.ids)
            cron._liwan_run_meeting_reminders()
            self.assertEqual(Message.search(domain).ids, messages.ids)

    def test_a_new_meeting_carries_the_company_prefix_and_the_year(self):
        Meeting = self.env['liwan.meeting.minute'].sudo()
        numbered = Meeting.create({'name': 'Before the change', 'organizer_id': self.planner.id})
        year = fields.Date.context_today(Meeting).year
        self.assertTrue(numbered.reference.startswith(f'MIN/{year}/'), numbered.reference)
        sequence = str(int(numbered.reference.rsplit('/', 1)[1]) + 1).zfill(4)
        self.assertEqual(self._patch({'reference_prefix': 'OPS1'}).status_code, 200)
        self._authenticate_planner()
        created = self.api('POST', '/api/v1/meetings', {'name': 'Prefixed'})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['reference'], f'OPS1/{year}/{sequence}')

    def test_existing_meetings_keep_their_reference(self):
        older = self.env['liwan.meeting.minute'].create({'name': 'Older minutes', 'organizer_id': self.planner.id})
        self.assertTrue(older.reference.startswith('MIN/'), older.reference)
        self.assertEqual(self._patch({'reference_prefix': 'OPS1'}).status_code, 200)
        newer = self.env['liwan.meeting.minute'].create({'name': 'Newer minutes', 'organizer_id': self.planner.id})
        older.invalidate_recordset(['reference'])
        self.assertTrue(older.reference.startswith('MIN/'), older.reference)
        self.assertTrue(newer.reference.startswith('OPS1/'), newer.reference)
        self.assertNotEqual(older.reference, newer.reference)

    def test_each_company_numbers_with_its_own_prefix(self):
        other = self.env['res.company'].create({'name': 'Other Numbering Co'})
        self.Settings.sudo().create({'company_id': other.id, 'reference_prefix': 'DIV2'})
        # A member of both companies: the reference of a meeting follows the meeting's own company.
        elsewhere = self.planner.sudo()
        elsewhere.company_ids = [(4, other.id)]
        self.assertTrue(
            elsewhere.with_company(other).env['liwan.meeting.minute'].create({'name': 'Elsewhere', 'company_id': other.id, 'organizer_id': elsewhere.id,
            }).reference.startswith('DIV2/'),
        )
        self.assertTrue(
            self.env['liwan.meeting.minute'].create({'name': 'Here', 'organizer_id': self.planner.id}).reference.startswith('MIN/'),
        )

    def test_a_series_accepts_the_daily_recurrence(self):
        self._authenticate_planner()
        response = self.api('POST', '/api/v1/meeting-series', SERIES)
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body['recurrence'], 'daily')
        starts = [row['start_datetime'] for row in body['meetings']]
        self.assertEqual(len(starts), 3)
        self.assertEqual(starts, ['2026-09-08T09:00:00Z', '2026-09-09T09:00:00Z', '2026-09-10T09:00:00Z'])
        self.assertEqual([row['meeting_date'] for row in body['meetings']], ['2026-09-08', '2026-09-09', '2026-09-10'])

    def test_a_daily_series_ends_at_its_date_within_the_same_cap(self):
        self._authenticate_planner()
        by_date = self.api('POST', '/api/v1/meeting-series', {
            **{key: value for key, value in SERIES.items() if key != 'until_count'},
            'name': 'Daily until date', 'until_date': '2026-09-10',
        })
        self.assertEqual(by_date.status_code, 201, by_date.text)
        self.assertEqual(len(by_date.json()['meetings']), 3)
        too_long = self.api('POST', '/api/v1/meeting-series', {
            **{key: value for key, value in SERIES.items() if key != 'until_count'},
            'name': 'Daily too long', 'until_date': '2026-12-31',
        })
        self.assertEqual(too_long.status_code, 422, too_long.text)
        self.assertIn('60', too_long.json()['message'])
        too_many = self.api('POST', '/api/v1/meeting-series', {**SERIES, 'name': 'Daily over count', 'until_count': 61})
        self.assertEqual((too_many.status_code, too_many.json()['field']), (422, 'until_count'))

    def test_an_unknown_recurrence_is_still_refused(self):
        self._authenticate_planner()
        response = self.api('POST', '/api/v1/meeting-series', {**SERIES, 'name': 'Hourly', 'recurrence': 'hourly'})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'recurrence'))
