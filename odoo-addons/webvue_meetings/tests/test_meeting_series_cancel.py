# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import WebVueMeetingsCase


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingSeriesCancel(WebVueMeetingsCase):
    """POST /meeting-series/<id>/cancel ends a series: upcoming open meetings are cancelled, the series is archived."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        permission = cls.env['webvue.access.permission']
        roles = {}
        for key, keys in (('reader', ['meetings.read', 'meetings.create']), ('manager', ['meetings.read', 'meetings.create', 'meetings.manage'])):
            roles[key] = cls.env['webvue.access.role'].create({
                'name_ar': f'سلسلة {key}', 'key': f'meeting_series_cancel_{key}', 'type': 'custom',
                'company_id': company.id,
                'permission_ids': [(6, 0, permission.search([('key', 'in', keys)]).ids)],
            })
        cls.env['webvue.access.assignment'].create([
            {'user_id': cls.employee.id, 'role_id': roles['reader'].id, 'company_id': company.id},
            {'user_id': cls.manager.id, 'role_id': roles['manager'].id, 'company_id': company.id},
        ])

    def _series(self, organizer, name='Steering'):
        return self.env['webvue.meeting.series'].create({
            'name': name, 'recurrence': 'none', 'organizer_id': organizer.id,
            'attendee_ids': [(6, 0, (self.employee | self.manager).ids)],
        })

    def _meeting(self, series, days):
        return self.env['webvue.meeting.minute'].create({
            'name': f'{series.name} {days}', 'state': 'draft', 'organizer_id': series.organizer_id.id,
            'series_id': series.id, 'meeting_date': fields.Date.today() + timedelta(days=days),
            'attendee_ids': [(6, 0, series.attendee_ids.ids)],
        })

    def _cancel(self, series, user='api_mgr'):
        self.authenticate(user, f'{user}_pass_123')
        return self.api('POST', f'/api/v1/meeting-series/{series.id}/cancel')

    def test_manager_ends_series_cancelling_only_upcoming_open_meetings(self):
        series = self._series(self.manager)
        past, soon, later, already = (self._meeting(series, days) for days in (-10, 5, 12, 20))
        already.action_cancel()
        response = self._cancel(series)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIs(body['active'], False)
        self.assertEqual(len(body['meetings']), 4)
        self.assertEqual(
            {meeting.id: meeting.state for meeting in (past | soon | later | already)},
            {past.id: 'draft', soon.id: 'cancelled', later.id: 'cancelled', already.id: 'cancelled'},
        )
        self.assertFalse(series.active)
        self.assertEqual(len(series.meeting_ids), 4)

    def test_ended_series_stays_listed_and_takes_no_new_meeting(self):
        series = self._series(self.manager)
        self._cancel(series)
        listed = {row['id']: row for row in self.api('GET', '/api/v1/meeting-series').json()['items']}
        self.assertIs(listed[series.id]['active'], False)
        self.assertIs(self.api('GET', f'/api/v1/meeting-series/{series.id}').json()['active'], False)
        response = self.api('POST', f'/api/v1/meeting-series/{series.id}/occurrences', {})
        self.assertEqual(response.status_code, 422, response.text)
        response = self.api('POST', '/api/v1/meetings', {'name': 'Late', 'meeting_date': '2030-01-01', 'series_id': series.id})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse(series.meeting_ids)

    def test_ending_twice_is_a_no_op(self):
        series = self._series(self.manager)
        meeting = self._meeting(series, 5)
        self.assertEqual(self._cancel(series).status_code, 200)
        meeting.action_reset_draft()
        self.assertEqual(self._cancel(series).status_code, 200)
        self.assertEqual(meeting.state, 'draft')

    def test_non_manager_organizer_ends_only_a_series_with_nothing_to_cancel(self):
        series = self._series(self.employee)
        meeting = self._meeting(series, 5)
        response = self._cancel(series, 'api_emp')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertTrue(series.active)
        self.assertEqual(meeting.state, 'draft')
        meeting.action_cancel()
        self.assertEqual(self._cancel(series, 'api_emp').status_code, 200)
        self.assertFalse(series.active)

    def test_attendee_who_is_not_an_editor_cannot_end_the_series(self):
        series = self._series(self.manager)
        response = self._cancel(series, 'api_emp')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertTrue(series.active)
