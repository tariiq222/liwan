# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.nasq_pmo.tests.common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingSeriesProjects(NasqPmoCase):
    """Meeting series with projects and converted tasks (the meetings/PMO bridge)."""

    def setUp(self):
        super().setUp()
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_create')
        self.manager.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read') | self.env.ref('nasq_meetings.group_cap_meetings_manage')

    def test_series_search_by_location_and_project(self):
        target = self.env['nasq.meeting.series'].create({
            'name': 'Operations cadence', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'project_id': self.project.id, 'location': 'War Room',
        })
        self.env['nasq.meeting.series'].create({
            'name': 'Company cadence', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'location': 'War Room',
        })
        self.env['nasq.meeting.series'].create({
            'name': 'Project cadence', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'project_id': self.project.id, 'location': 'Training Room',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', f'/api/v1/meeting-series?q=War%20Room&project_id={self.project.id}')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], 1)
        self.assertEqual([row['id'] for row in body['items']], [target.id])

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
