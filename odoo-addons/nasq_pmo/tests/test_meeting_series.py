# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingSeries(NasqPmoCase):

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read') | self.env.ref('nasq_core.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read') | self.env.ref('nasq_core.group_cap_meetings_manage')

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

    def test_converted_resolution_execution_is_frozen(self):
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Convert freeze', 'organizer_id': self.employee.id,
            'attendee_ids': [(6, 0, self.employee.ids)], 'meeting_date': fields.Date.today(),
        })
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Follow', 'responsible_id': self.employee.id,
            'deadline': fields.Date.today(),
        })
        task = resolution.action_convert_to_task(self.project.id)
        task.write({'active': False})
        with self.assertRaises(UserError):
            resolution.with_user(self.employee).action_start()
        for values in ({'name': 'Changed after conversion'}, {'deadline': '2026-10-01'}):
            with self.assertRaises(UserError):
                resolution.with_user(self.employee).write(values)

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

    def test_converted_resolution_has_no_overdue_reminder_or_execution_actions(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'قراءة المشاريع والمهام', 'key': 'meeting_task_link_read',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        self.project.write({'company_id': self.env.company.id})
        series = self.env['nasq.meeting.series'].create({
            'name': 'Converted overdue series', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        meeting = series.action_add_occurrence(
            datetime(2026, 9, 1, 9, 0), datetime(2026, 9, 1, 10, 0), 'Converted overdue',
        )
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Follow on task', 'responsible_id': self.employee.id,
            'deadline': '2020-01-01',
        })
        task = resolution.action_convert_to_task(self.project.id)
        following = series.action_add_occurrence(
            datetime(2026, 9, 8, 9, 0), datetime(2026, 9, 8, 10, 0), 'Following meeting',
        )
        self.env['cyan.meeting.minute']._nasq_run_meeting_reminders()
        self.assertFalse(self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', '=', meeting.id),
            ('nasq_notification_kind', '=', 'meeting_resolution_overdue'),
        ]))
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/meetings/{meeting.id}').json()
        converted = next(item for item in body['resolutions'] if item['id'] == resolution.id)
        self.assertEqual(converted['task_id'], task.id)
        self.assertFalse(converted['can_update_execution'])
        self.assertFalse(converted['can_edit_decision'])
        prior_response = self.api('GET', f'/api/v1/meetings/{following.id}')
        self.assertEqual(prior_response.status_code, 200, prior_response.text)
        prior = prior_response.json()['previous_resolutions']
        prior_row = next(item for item in prior if item['id'] == resolution.id)
        self.assertEqual(prior_row['task_id'], task.id)
        task.write({'active': False})
        self.env['cyan.meeting.minute']._nasq_run_meeting_reminders()
        archived_response = self.api('GET', f'/api/v1/meetings/{following.id}')
        self.assertEqual(archived_response.status_code, 200, archived_response.text)
        archived_prior = archived_response.json()['previous_resolutions']
        archived_row = next(item for item in archived_prior if item['id'] == resolution.id)
        self.assertIsNone(archived_row['task_id'])
        self.assertFalse(archived_row['can_update_execution'])
        self.assertFalse(archived_row['can_edit_decision'])
        self.assertFalse(self.env['mail.message'].sudo().search([
            ('nasq_meeting_id', '=', meeting.id),
            ('nasq_notification_kind', '=', 'meeting_resolution_overdue'),
        ]))
