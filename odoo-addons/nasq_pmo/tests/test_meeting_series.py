# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingSeries(NasqPmoCase):

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read') | self.env.ref('nasq_core.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read') | self.env.ref('nasq_core.group_cap_meetings_manage')

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
