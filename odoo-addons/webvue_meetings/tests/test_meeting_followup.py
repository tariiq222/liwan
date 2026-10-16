# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .test_meeting_workspace import TestMeetingWorkspace


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingFollowup(TestMeetingWorkspace):
    """Reuse the workspace's actors and invariants for the same read boundary."""

    def test_followup_visibility_filters_and_pagination(self):
        meeting = self._meeting(name='Global followup source')
        resolutions = self.env['webvue.meeting.resolution'].create([
            {'meeting_id': meeting.id, 'name': f'Followup {i:03}',
             'responsible_id': self.employee.id, 'deadline': '2020-01-01'}
            for i in range(105)
        ])
        # Non-participants cannot discover recommendations from another meeting.
        hidden = self._meeting(organizer_id=self.manager.id)
        self.env['webvue.meeting.resolution'].create({
            'meeting_id': hidden.id, 'name': 'Hidden assigned',
            'responsible_id': self.manager.id, 'execution_period': 'Continuous',
        })
        other_company = self.env['res.company'].create({'name': 'Followup other company'})
        self.manager.company_ids |= other_company
        other = self._meeting(company_id=other_company.id, organizer_id=self.manager.id)
        self.env['webvue.meeting.resolution'].create({
            'meeting_id': other.id, 'name': 'Other company',
            'responsible_id': self.manager.id, 'execution_period': 'Continuous',
        })
        self._authenticate_employee()
        response = self.api('GET', '/api/v1/meetings/resolutions?mine=1&state=overdue')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 105)
        self.assertEqual(len(response.json()['items']), 25)
        first_ids = {row['id'] for row in response.json()['items']}
        second = self.api('GET', '/api/v1/meetings/resolutions?mine=1&state=overdue&offset=25')
        self.assertFalse(first_ids & {row['id'] for row in second.json()['items']})
        capped = self.api('GET', '/api/v1/meetings/resolutions?limit=200&q=Followup')
        self.assertEqual(len(capped.json()['items']), 100)
        self.assertTrue(all(row['meeting_id'] == meeting.id for row in capped.json()['items']))
        invalid = self.api('GET', '/api/v1/meetings/resolutions?state=unknown')
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()['field'], 'state')
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        forbidden = self.api('GET', '/api/v1/meetings/resolutions')
        self.assertEqual(forbidden.status_code, 403, forbidden.text)
        self.assertEqual(len(resolutions), 105)

    def test_followup_participant_and_secretary_keep_existing_visibility(self):
        for values in ({'attendee_ids': [(6, 0, self.employee.ids)]}, {'secretary_id': self.employee.id}):
            meeting = self._meeting(organizer_id=self.manager.id, **values)
            self.env['webvue.meeting.resolution'].create({
                'meeting_id': meeting.id, 'name': 'Participant followup',
                'responsible_id': self.manager.id, 'execution_period': 'Continuous',
            })
        self._authenticate_employee()
        response = self.api('GET', '/api/v1/meetings/resolutions?q=Participant')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 2)
        mine = self.api('GET', '/api/v1/meetings/resolutions?q=Participant&mine=1')
        self.assertEqual(mine.json()['total'], 0)
