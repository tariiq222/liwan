# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import NasqMeetingsCase
from odoo.addons.nasq_meetings.serializers.meeting import dump_meetings, dump_series


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingSeries(NasqMeetingsCase):

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_manage')

    def _grant_meeting_create(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات عبر HTTP', 'key': 'meeting_http_create',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })

    def test_standalone_meeting_has_no_series(self):
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Independent', 'organizer_id': self.employee.id, 'meeting_date': fields.Date.today(),
        })
        self.assertFalse(meeting.series_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        row = self.api('GET', f'/api/v1/meetings/{meeting.id}').json()
        self.assertIsNone(row['series_id'])
        self.assertEqual(row['open_resolution_count'], 0)

    def test_ondemand_series_adds_independent_minutes(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'لجنة التشغيل', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'attendee_ids': [(6, 0, self.manager.ids)],
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'لقاء 1')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'لقاء 2')
        self.assertEqual(first.series_id, series)
        self.assertNotEqual(first.id, second.id)
        self.assertFalse(first.minutes)
        self.assertFalse(second.minutes)

    def test_http_series_creation_generates_supported_recurrences(self):
        self._grant_meeting_create()
        self.authenticate('api_emp', 'api_emp_pass_123')
        cases = (
            ('weekly', {'until_count': 3}, 3, '09:00', '10:00'),
            ('biweekly', {'until_count': 2}, 2, '11:00', '12:00'),
            ('monthly', {'until_date': '2026-12-31'}, 4, '13:00', '14:00'),
        )
        for recurrence, end, expected_count, start_hour, end_hour in cases:
            body = {
                'name': f'HTTP {recurrence}', 'recurrence': recurrence,
                'start_datetime': f'2026-09-08T{start_hour}:00.000Z',
                'end_datetime': f'2026-09-08T{end_hour}:00.000Z', **end,
            }
            response = self.api('POST', '/api/v1/meeting-series', body)
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(len(response.json()['meetings']), expected_count)

    def test_http_series_creation_rejects_bad_recurrence_datetimes_and_bounds(self):
        self._grant_meeting_create()
        self.authenticate('api_emp', 'api_emp_pass_123')
        common = {'name': 'Invalid series', 'recurrence': 'weekly'}
        malformed = self.api('POST', '/api/v1/meeting-series', {
            **common, 'start_datetime': 'tomorrow', 'end_datetime': '2026-09-08T10:00:00Z',
            'until_count': 2,
        })
        self.assertEqual(malformed.status_code, 422, malformed.text)
        same_time = self.api('POST', '/api/v1/meeting-series', {
            **common, 'start_datetime': '2026-09-08T10:00:00Z',
            'end_datetime': '2026-09-08T10:00:00Z', 'until_count': 2,
        })
        self.assertEqual(same_time.status_code, 422, same_time.text)
        both_ends = self.api('POST', '/api/v1/meeting-series', {
            **common, 'start_datetime': '2026-09-08T09:00:00Z',
            'end_datetime': '2026-09-08T10:00:00Z', 'until_count': 2,
            'until_date': '2026-12-31',
        })
        self.assertEqual(both_ends.status_code, 422, both_ends.text)
        too_many = self.api('POST', '/api/v1/meeting-series', {
            **common, 'start_datetime': '2026-09-08T09:00:00Z',
            'end_datetime': '2026-09-08T10:00:00Z', 'until_date': '2028-01-01',
        })
        self.assertEqual(too_many.status_code, 422, too_many.text)

    def test_participant_cannot_attach_generic_meeting_to_series(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات فقط', 'key': 'meeting_create_only',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        self.env['cyan.meeting.minute'].with_user(self.employee).create({
            'name': 'Own meeting', 'organizer_id': self.employee.id,
            'meeting_date': fields.Date.today(),
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Managed series', 'recurrence': 'none', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        with self.assertRaises(AccessError):
            series.with_user(self.employee).action_add_occurrence()
        with self.assertRaises(AccessError):
            self.env['cyan.meeting.minute'].with_user(self.employee).create({
                'name': 'Illicit occurrence', 'series_id': series.id,
                'organizer_id': self.employee.id,
                'meeting_date': fields.Date.today(),
            })

    def test_participant_cannot_generate_occurrences_for_series(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات للتكرار', 'key': 'meeting_recurrence_create_only',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Managed recurrence', 'recurrence': 'weekly', 'until_count': 2,
            'organizer_id': self.manager.id, 'attendee_ids': [(6, 0, self.employee.ids)],
        })
        with self.assertRaises(AccessError):
            series.with_user(self.employee).action_generate_occurrences(
                datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0),
            )

    def test_series_visibility_is_revoked_after_last_occurrence_visibility(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Revoked series', 'recurrence': 'none', 'organizer_id': self.manager.id,
        })
        occurrence = self.env['cyan.meeting.minute'].create({
            'name': 'Visible occurrence', 'state': 'draft', 'series_id': series.id,
            'organizer_id': self.manager.id, 'attendee_ids': [(6, 0, self.employee.ids)],
            'meeting_date': fields.Date.today(),
        })
        employee_series = series.with_user(self.employee)
        employee_series.check_access('read')
        occurrence.write({'attendee_ids': [(6, 0, [])]})
        with self.assertRaises(AccessError):
            employee_series.invalidate_recordset()
            employee_series.check_access('read')

    def test_this_and_following_applies_content_only_to_current_occurrence(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Scoped content', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'attendee_ids': [(6, 0, self.manager.ids)],
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'A')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'B')
        first.action_apply_schedule_scope({
            'name': 'Updated current', 'agenda': '<p>agenda</p>', 'minutes': '<p>minutes</p>',
            'attendee_ids': [], 'secretary_id': self.manager.id,
            'start_datetime': datetime(2026, 9, 8, 11, 0),
            'end_datetime': datetime(2026, 9, 8, 12, 0),
        }, 'this_and_following')
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual((first.name, first.agenda, first.minutes, first.secretary_id),
                         ('Updated current', '<p>agenda</p>', '<p>minutes</p>', self.manager))
        self.assertEqual(second.name, 'Updated current')
        self.assertFalse(second.agenda)
        self.assertFalse(second.minutes)
        self.assertEqual(second.attendee_ids, self.manager)
        self.assertEqual(second.start_datetime, datetime(2026, 9, 15, 11, 0))

    def test_this_and_following_backward_shift_uses_final_schedule(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Backward shift', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'A')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'B')
        third = series.action_add_occurrence(datetime(2026, 9, 22, 9, 0), datetime(2026, 9, 22, 10, 0), 'C')
        series.invalidate_recordset(['meeting_ids'])
        first.action_apply_schedule_scope({
            'start_datetime': datetime(2026, 9, 1, 9, 0),
            'end_datetime': datetime(2026, 9, 1, 10, 0),
        }, 'this_and_following')
        for meeting in (first, second, third):
            meeting.invalidate_recordset()
        self.assertEqual([meeting.start_datetime for meeting in (first, second, third)], [
            datetime(2026, 9, 1, 9, 0), datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 15, 9, 0),
        ])

    def test_this_and_following_end_only_preserves_each_start(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'End only', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'A')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'B')
        first.action_apply_schedule_scope({
            'end_datetime': datetime(2026, 9, 8, 11, 0),
        }, 'this_and_following')
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual(first.end_datetime, datetime(2026, 9, 8, 11, 0))
        self.assertEqual(second.start_datetime, datetime(2026, 9, 15, 9, 0))
        self.assertEqual(second.end_datetime, datetime(2026, 9, 15, 11, 0))

    def test_this_and_following_keeps_each_date_when_start_is_unchanged(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Unchanged schedule', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'A')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'B')
        first.action_apply_schedule_scope({
            'start_datetime': first.start_datetime, 'end_datetime': first.end_datetime,
            'location': 'Room 2', 'agenda': '<p>current only</p>',
        }, 'this_and_following')
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual(second.start_datetime, datetime(2026, 9, 15, 9, 0))
        self.assertEqual(second.end_datetime, datetime(2026, 9, 15, 10, 0))
        self.assertEqual((first.location, second.location), ('Room 2', 'Room 2'))
        self.assertEqual(first.agenda, '<p>current only</p>')
        self.assertFalse(second.agenda)

    def test_scope_overlap_rolls_back_all_occurrences_and_notifications(self):
        external = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'External clash', 'organizer_id': self.manager.id,
            'start_datetime': datetime(2026, 9, 8, 9, 0),
            'end_datetime': datetime(2026, 9, 8, 10, 0), 'meeting_date': '2026-09-08',
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Atomic overlap', 'recurrence': 'none', 'organizer_id': self.manager.id,
            'secretary_id': self.employee.id,
        })
        first = series.action_add_occurrence(
            datetime(2026, 9, 8, 11, 0), datetime(2026, 9, 8, 12, 0), 'A',
        )
        second = series.action_add_occurrence(
            datetime(2026, 9, 15, 11, 0), datetime(2026, 9, 15, 12, 0), 'B',
        )
        with self.assertRaises(ValidationError):
            first.with_user(self.employee).action_apply_schedule_scope({
                'start_datetime': external.start_datetime,
                'end_datetime': external.end_datetime,
            }, 'this_and_following')
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual(first.start_datetime, datetime(2026, 9, 8, 11, 0))
        self.assertEqual(second.start_datetime, datetime(2026, 9, 15, 11, 0))
        self.assertFalse(self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', 'in', [first.id, second.id]),
            ('nasq_notification_kind', '=', 'meeting_changed'),
        ]))

    def test_weekly_recurrence_and_this_only_keeps_later_minutes(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'أسبوعي', 'recurrence': 'weekly', 'until_count': 3, 'organizer_id': self.employee.id,
        })
        meetings = series.action_generate_occurrences(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0)).sorted('meeting_date')
        self.assertEqual(len(meetings), 3)
        meetings[2].write({'minutes': '<p>kept</p>'})
        meetings[0].action_apply_schedule_scope({
            'start_datetime': datetime(2026, 9, 8, 11, 0),
            'end_datetime': datetime(2026, 9, 8, 12, 0),
        }, 'this')
        meetings[2].invalidate_recordset()
        self.assertEqual(meetings[0].start_datetime, datetime(2026, 9, 8, 11, 0))
        self.assertEqual(meetings[2].minutes, '<p>kept</p>')
        self.assertEqual(meetings[2].start_datetime, datetime(2026, 9, 22, 9, 0))

    def test_this_and_following_skips_completed_minutes(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Future edit', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'A')
        second = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'B')
        third = series.action_add_occurrence(datetime(2026, 9, 22, 9, 0), datetime(2026, 9, 22, 10, 0), 'C')
        second.write({'minutes': '<p>old</p>', 'state': 'confirmed'})
        second.action_done()
        first.action_apply_schedule_scope({
            'start_datetime': datetime(2026, 9, 8, 11, 0),
            'end_datetime': datetime(2026, 9, 8, 12, 0),
        }, 'this_and_following')
        self.assertEqual(first.start_datetime, datetime(2026, 9, 8, 11, 0))
        second.invalidate_recordset()
        self.assertEqual(second.minutes, '<p>old</p>')
        self.assertEqual(second.start_datetime, datetime(2026, 9, 15, 9, 0))
        self.assertEqual(third.start_datetime, datetime(2026, 9, 22, 11, 0))

    def test_hidden_occurrence_is_not_listed_inside_series(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Mixed', 'recurrence': 'none', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        visible = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Seen', 'series_id': series.id, 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)], 'meeting_date': fields.Date.today(),
        })
        hidden = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Hidden', 'series_id': series.id, 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, [])], 'meeting_date': fields.Date.today(),
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/meeting-series/{series.id}').json()
        ids = [row['id'] for row in body['meetings']]
        self.assertIn(visible.id, ids)
        self.assertNotIn(hidden.id, ids)

    def test_month_window_returns_more_than_200(self):
        Meeting = self.env['cyan.meeting.minute']
        Meeting.create([{
            'state': 'draft', 'name': f'M{index}', 'organizer_id': self.employee.id,
            'meeting_date': '2026-10-01',
        } for index in range(210)])
        self.authenticate('api_emp', 'api_emp_pass_123')
        capped = self.api('GET', '/api/v1/meetings?limit=200').json()
        self.assertEqual(len(capped['items']), 200)
        month = self.api('GET', '/api/v1/meetings?date_from=2026-10-01&date_to=2026-10-31&limit=2000').json()
        self.assertGreaterEqual(month['total'], 210)
        self.assertGreaterEqual(len(month['items']), 210)

    def test_organizer_overlap_rejected(self):
        self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'First', 'organizer_id': self.employee.id,
            'start_datetime': datetime(2026, 9, 8, 9, 0),
            'end_datetime': datetime(2026, 9, 8, 10, 0),
            'meeting_date': '2026-09-08',
        })
        with self.assertRaises(ValidationError):
            self.env['cyan.meeting.minute'].create({
                'state': 'draft', 'name': 'Clash', 'organizer_id': self.employee.id,
                'start_datetime': datetime(2026, 9, 8, 9, 30),
                'end_datetime': datetime(2026, 9, 8, 10, 30),
                'meeting_date': '2026-09-08',
            })

    def test_previous_series_resolutions_are_listed_not_copied(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Carry', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 1, 9, 0), datetime(2026, 9, 1, 10, 0), 'Old')
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': first.id, 'name': 'Open item', 'responsible_id': self.employee.id,
            'deadline': fields.Date.today(),
        })
        second = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'New')
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/meetings/{second.id}').json()
        names = [row['name'] for row in body['previous_resolutions']]
        self.assertEqual(names, ['Open item'])
        self.assertFalse(second.resolution_ids)

    def test_previous_series_resolutions_exclude_future_occurrences(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Chronological carry', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(datetime(2026, 9, 1, 9, 0), datetime(2026, 9, 1, 10, 0), 'First')
        second = series.action_add_occurrence(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'Second')
        third = series.action_add_occurrence(datetime(2026, 9, 15, 9, 0), datetime(2026, 9, 15, 10, 0), 'Third')
        for meeting, name in ((first, 'First item'), (third, 'Future item')):
            self.env['cyan.meeting.resolution'].create({
                'meeting_id': meeting.id, 'name': name, 'responsible_id': self.employee.id,
                'deadline': fields.Date.today(),
            })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/meetings/{second.id}').json()
        self.assertEqual([row['name'] for row in body['previous_resolutions']], ['First item'])

    def test_rescheduled_meeting_gets_a_reminder_for_its_new_start(self):
        now = fields.Datetime.now()
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Rescheduled reminder', 'state': 'draft', 'organizer_id': self.employee.id,
            'attendee_ids': [(6, 0, self.manager.ids)],
            'start_datetime': now + timedelta(hours=2), 'end_datetime': now + timedelta(hours=3),
            'meeting_date': fields.Date.to_date(now),
        })
        self.env['cyan.meeting.minute']._nasq_run_meeting_reminders()
        meeting.write({
            'start_datetime': now + timedelta(hours=4), 'end_datetime': now + timedelta(hours=5),
        })
        self.env['cyan.meeting.minute']._nasq_run_meeting_reminders()
        reminders = self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', '=', meeting.id), ('nasq_notification_kind', '=', 'meeting_reminder'),
        ])
        self.assertEqual(len(reminders), 4)
        for partner in meeting._cyan_participant_users().mapped('partner_id'):
            self.assertEqual(sum(
                partner in message.notification_ids.mapped('res_partner_id')
                for message in reminders
            ), 2)

    def test_recancelled_meeting_notifies_again_after_reopen(self):
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Recancel notification', 'state': 'draft', 'organizer_id': self.employee.id,
            'attendee_ids': [(6, 0, self.manager.ids)], 'meeting_date': fields.Date.today(),
        })
        meeting.action_cancel()
        meeting.action_reset_draft()
        meeting.action_cancel()
        messages = self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', '=', meeting.id), ('nasq_notification_kind', '=', 'meeting_cancelled'),
        ])
        self.assertEqual(len(messages), 4)

    def test_http_series_creation_validates_url_and_people(self):
        self._grant_meeting_create()
        other = self.env['res.company'].create({'name': 'Series outsider Co'})
        outsider = new_test_user(
            self.env, login='series_outsider', name='Omar', groups='nasq_core.group_employee',
            company_id=other.id, company_ids=[other.id],
        )
        self.authenticate('api_emp', 'api_emp_pass_123')
        for field, body in [
            ('meeting_url', {'name': 'Bad url', 'meeting_url': 'javascript:alert(1)'}),
            ('secretary_id', {'name': 'Bad secretary', 'secretary_id': outsider.id}),
            ('attendee_ids', {'name': 'Bad attendees', 'attendee_ids': [self.manager.id, outsider.id]}),
        ]:
            response = self.api('POST', '/api/v1/meeting-series', body)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['field'], field)
        self.assertEqual(self.env['nasq.meeting.series'].search_count([('name', 'ilike', 'Bad ')]), 0)
        created = self.api('POST', '/api/v1/meeting-series', {
            'name': 'Valid series', 'meeting_url': 'https://meet.example.com/x', 'attendee_ids': [self.manager.id],
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['meeting_url'], 'https://meet.example.com/x')

    def test_occurrence_days_follow_the_organizer_timezone(self):
        self.employee.tz = 'Asia/Riyadh'
        series = self.env['nasq.meeting.series'].create({
            'name': 'Early weekly', 'recurrence': 'weekly', 'until_count': 3, 'organizer_id': self.employee.id,
        })
        # 01:00 on Tuesday 2026-09-08 in Riyadh (UTC+3) is 22:00 UTC on Monday 2026-09-07.
        meetings = series.action_generate_occurrences(datetime(2026, 9, 7, 22, 0), datetime(2026, 9, 7, 23, 0))
        self.assertEqual(
            [(m.meeting_date.isoformat(), m.start_datetime) for m in meetings.sorted('start_datetime')],
            [
                ('2026-09-08', datetime(2026, 9, 7, 22, 0)),
                ('2026-09-15', datetime(2026, 9, 14, 22, 0)),
                ('2026-09-22', datetime(2026, 9, 21, 22, 0)),
            ],
        )
        self.assertEqual(meetings[0].calendar_event_id.recurrence_id.event_tz, 'Asia/Riyadh')
        self.assertTrue(meetings[0].calendar_event_id.recurrence_id.tue)
        on_demand = self.env['nasq.meeting.series'].create({
            'name': 'Early on demand', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        added = on_demand.action_add_occurrence(datetime(2026, 10, 7, 22, 0), datetime(2026, 10, 7, 23, 0))
        self.assertEqual(added.meeting_date.isoformat(), '2026-10-08')

    def test_monthly_series_on_the_31st_keeps_the_local_month_day(self):
        self.employee.tz = 'Asia/Riyadh'
        series = self.env['nasq.meeting.series'].create({
            'name': 'Month end', 'recurrence': 'monthly', 'until_count': 3, 'organizer_id': self.employee.id,
        })
        # 01:00 on 2026-01-31 in Riyadh is 22:00 UTC on 2026-01-30.
        meetings = series.action_generate_occurrences(datetime(2026, 1, 30, 22, 0), datetime(2026, 1, 30, 23, 0))
        self.assertEqual(
            [m.meeting_date.isoformat() for m in meetings.sorted('start_datetime')],
            ['2026-01-31', '2026-03-31', '2026-05-31'],
        )
        self.assertEqual(meetings[0].calendar_event_id.recurrence_id.day, 31)


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingSeriesBatches(NasqMeetingsCase):
    """Series generation notifies once, cron skips cancelled meetings, list serializers stay bounded."""

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_manage')

    def _messages(self, kind, meetings):
        return self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', 'in', meetings.ids), ('nasq_notification_kind', '=', kind),
        ])

    def test_generated_series_sends_one_series_invite_per_participant(self):
        other = new_test_user(self.env, login='series_invite_nora', name='Nora', groups='nasq_core.group_employee')
        series = self.env['nasq.meeting.series'].create({
            'name': 'لجنة أسبوعية', 'recurrence': 'weekly', 'until_count': 4, 'organizer_id': self.employee.id,
            'secretary_id': self.manager.id, 'attendee_ids': [(6, 0, other.ids)],
        })
        participants = self.employee.partner_id | self.manager.partner_id | other.partner_id
        meetings = series.action_generate_occurrences(datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0))
        self.assertEqual(len(meetings), 4)
        self.assertFalse(self._messages('meeting_invite', meetings))
        invites = self._messages('meeting_series_invite', meetings)
        self.assertEqual(len(invites), 3)
        self.assertEqual(set(invites.mapped('nasq_meeting_id')), {meetings.sorted('start_datetime')[0].id})
        self.assertEqual(set(invites.notification_ids.mapped('res_partner_id')), set(participants))
        self.assertTrue(all('لجنة أسبوعية' in body for body in invites.mapped('body')))
        # An occurrence added later to the series still invites its participants itself.
        later = series.action_add_occurrence(datetime(2026, 10, 6, 9, 0), datetime(2026, 10, 6, 10, 0), 'Extra')
        self.assertEqual(len(self._messages('meeting_invite', later)), 3)

    def test_overdue_reminders_skip_cancelled_meetings(self):
        live, cancelled = self.env['cyan.meeting.minute'].create([{
            'name': name, 'state': 'draft', 'organizer_id': self.employee.id, 'meeting_date': '2026-09-01',
            'attendee_ids': [(6, 0, self.manager.ids)],
        } for name in ('Live overdue', 'Cancelled overdue')])
        for meeting in (live, cancelled):
            self.env['cyan.meeting.resolution'].create({
                'meeting_id': meeting.id, 'name': 'Late item', 'responsible_id': self.manager.id,
                'deadline': '2020-01-01',
            })
        cancelled.action_cancel()
        self.env['cyan.meeting.minute']._nasq_run_meeting_reminders()
        self.assertEqual(len(self._messages('meeting_resolution_overdue', live)), 1)
        self.assertFalse(self._messages('meeting_resolution_overdue', cancelled))

    def _occurrences(self, series, count):
        Meeting = self.env['cyan.meeting.minute']
        meetings = Meeting.create([{
            'name': f'{series.name} {index}', 'state': 'draft', 'organizer_id': self.employee.id,
            'series_id': series.id, 'meeting_date': date(2026, 9, 1) + timedelta(days=index),
            'attendee_ids': [(6, 0, self.manager.ids)],
        } for index in range(count)])
        self.env['cyan.meeting.resolution'].create([{
            'meeting_id': meeting.id, 'name': f'Item {meeting.id}', 'responsible_id': self.manager.id,
            'deadline': '2020-01-01' if index % 2 else '2030-01-01',
        } for index, meeting in enumerate(meetings)])
        return meetings

    def _query_count(self, callback):
        self.env.flush_all()
        before = self.env.cr.sql_log_count
        callback()
        self.env.flush_all()
        return self.env.cr.sql_log_count - before

    def test_list_serializers_issue_a_bounded_number_of_queries(self):
        small = self.env['nasq.meeting.series'].create({'name': 'Small', 'recurrence': 'none', 'organizer_id': self.employee.id})
        large = self.env['nasq.meeting.series'].create({'name': 'Large', 'recurrence': 'none', 'organizer_id': self.employee.id})
        self._occurrences(small, 3)
        self._occurrences(large, 35)
        Meeting = self.env['cyan.meeting.minute'].with_user(self.employee)
        Series = self.env['nasq.meeting.series'].with_user(self.employee)

        def list_rows(series):
            def run():
                records = Meeting.search([('series_id', '=', series.id)], order='meeting_date desc, id desc')
                rows = dump_meetings(records)
                self.assertEqual(len(rows), len(records))
                self.assertEqual({row['open_resolution_count'] for row in rows}, {1})
            return run

        def series_detail(series):
            def run():
                payload = dump_series(Series.browse(series.id), detail=True)
                self.assertEqual(payload['open_resolution_count'], len(payload['meetings']))
                self.assertEqual(payload['overdue_resolution_count'], len(payload['meetings']) // 2)
            return run

        for build in (list_rows, series_detail):
            build(small)()  # warm the per-request caches (groups, capabilities, field metadata)
            self.assertEqual(self._query_count(build(large)), self._query_count(build(small)), build.__name__)
            self.assertLess(self._query_count(build(large)), 30, build.__name__)

    def test_series_resolutions_filter_order_and_paginate_in_the_orm(self):
        series = self.env['nasq.meeting.series'].create({'name': 'Paged', 'recurrence': 'none', 'organizer_id': self.employee.id})
        meetings = self._occurrences(series, 5)
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/meeting-series/{series.id}/resolutions'
        first = self.api('GET', f'{url}?limit=2').json()
        second = self.api('GET', f'{url}?limit=2&offset=2').json()
        self.assertEqual((first['total'], second['total']), (5, 5))
        latest_first = [meeting.id for meeting in meetings.sorted(key=lambda m: (m.meeting_date, m.id), reverse=True)]
        self.assertEqual([row['meeting_id'] for row in first['items'] + second['items']], latest_first[:4])
        by_meeting = self.api('GET', f'{url}?q={meetings[2].name.replace(" ", "%20")}').json()
        self.assertEqual([row['meeting_id'] for row in by_meeting['items']], [meetings[2].id])
        overdue = self.api('GET', f'{url}?state=overdue&limit=1').json()
        self.assertEqual((overdue['total'], len(overdue['items'])), (2, 1))
        self.assertEqual(self.api('GET', f'{url}?state=bogus').status_code, 422)
