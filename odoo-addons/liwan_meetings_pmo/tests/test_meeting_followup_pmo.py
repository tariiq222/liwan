# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo.tests import tagged

from .test_meeting_workspace_pmo import TestMeetingWorkspaceProjects
from odoo.addons.liwan_meetings.serializers.meeting import dump_resolution


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingFollowupProjects(TestMeetingWorkspaceProjects):

    def test_followup_uses_readable_task_state_before_count_and_page(self):
        series = self.env['liwan.meeting.series'].create({'name': 'Projected followup', 'organizer_id': self.employee.id})
        meeting = self._meeting(series_id=series.id)
        project = self.env['project.project'].create({'name': 'Followup project', 'company_id': self.env.company.id, 'user_id': self.employee.id})
        resolution = self.env['liwan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Converted done', 'responsible_id': self.employee.id, 'deadline': '2020-01-01',
        })
        task = resolution.action_convert_to_task(project.id)
        task.write({'state': '1_done'})
        self._authenticate_employee()
        for endpoint in ('/api/v1/meetings/resolutions', f'/api/v1/meeting-series/{series.id}/resolutions'):
            active = self.api('GET', endpoint + '?state=active&limit=1')
            self.assertEqual(active.status_code, 200, active.text)
            self.assertEqual(active.json()['total'], 0, active.text)
            done = self.api('GET', endpoint + '?state=done&limit=1')
            self.assertEqual(done.json()['total'], 1, done.text)
            self.assertEqual(done.json()['items'][0]['execution_state'], 'done')
            self.assertEqual(done.json()['items'][0]['task_id'], task.id)
        task.write({'active': False})
        archived = self.api('GET', '/api/v1/meetings/resolutions?state=active')
        self.assertEqual(archived.json()['total'], 1, archived.text)
        self.assertIsNone(archived.json()['items'][0]['task_id'])
        self.assertEqual(archived.json()['items'][0]['execution_state'], resolution.state)
        task.write({'active': True})
        assignment = self.env['liwan.access.assignment'].search([('user_id', '=', self.employee.id), ('role_id.key', '=', 'meeting_workspace_editor')])
        assignment.role_id.permission_ids -= self.env['liwan.access.permission'].search([('key', '=', 'pmo.tasks.read')])
        self.employee.group_ids -= self.env.ref('liwan_pmo.group_cap_pmo_tasks_read')
        hidden = self.api('GET', '/api/v1/meetings/resolutions?state=active')
        self.assertEqual(hidden.json()['total'], 1, hidden.text)
        self.assertIsNone(hidden.json()['items'][0]['task_id'])
        self.assertEqual(hidden.json()['items'][0]['execution_state'], resolution.state)

    def test_followup_query_count_stays_bounded_at_5000_recommendations(self):
        meeting = self._meeting()
        Resolution = self.env['liwan.meeting.resolution'].with_context(tracking_disable=True, mail_create_nolog=True)

        def create_rows(count):
            return Resolution.create([{'meeting_id': meeting.id, 'name': f'Scale {i}', 'responsible_id': self.employee.id, 'execution_period': 'Continuous'} for i in range(count)])
        create_rows(250)

        def page_cost():
            self.env.flush_all()
            self.env.invalidate_all()
            links = self.env['liwan.meeting.links'].with_user(self.employee)
            records = Resolution.with_user(self.employee)
            before = self.env.cr.sql_log_count
            domain = [('meeting_id', '=', meeting.id)] + links._liwan_resolution_execution_domain(('open', 'in_progress'))
            page = records.search(domain, limit=25, order='deadline asc, id desc')
            total = records.search_count(domain)
            readable = links._liwan_readable_links(page)
            linked = links._liwan_linked_resolution_ids(page)
            rows = [dump_resolution(row, readable.get(row.id), linked_ids=linked) for row in page]
            return self.env.cr.sql_log_count - before, total, rows
        small, count, rows = page_cost()
        self.assertEqual((count, len(rows)), (250, 25))
        create_rows(4750)
        large, count, rows = page_cost()
        self.assertEqual((count, len(rows)), (5000, 25))
        logging.getLogger(__name__).info('Followup query counts: 250=%s, 5000=%s, page_size=25', small, large)
        self.assertLessEqual(large, small + 5)
        self.assertLess(large, 120)

    def test_meeting_only_reader_does_not_need_project_access_for_followup(self):
        meeting = self._meeting()
        project = self.env['project.project'].create({'name': 'Hidden project name', 'company_id': self.env.company.id})
        self.env['liwan.meeting.resolution'].create({'meeting_id': meeting.id, 'name': 'Meeting only recommendation', 'responsible_id': self.employee.id, 'execution_period': 'Continuous', 'project_id': project.id})
        meeting._liwan_set_minutes_form({'opening': 'Opening', 'closing': '', 'chairperson': '', 'approver_name': '', 'approver_title': '', 'topics': [{'key': 'hidden-project', 'title': 'Topic', 'discussion': '', 'project_id': project.id, 'resolution_ids': []}]})
        role = self.env['liwan.access.role'].search([('key', '=', 'meeting_workspace_editor')])
        role.permission_ids -= self.env['liwan.access.permission'].search([('key', 'in', ['pmo.projects.read', 'pmo.tasks.read'])])
        self.employee.group_ids -= self.env.ref('liwan_pmo.group_cap_pmo_projects_read') | self.env.ref('liwan_pmo.group_cap_pmo_tasks_read')
        self._authenticate_employee()
        detail = self.api('GET', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertIsNone(detail.json()['minutes_form']['topics'][0]['project_id'])
        followup = self.api('GET', '/api/v1/meetings/resolutions')
        self.assertEqual(followup.status_code, 200, followup.text)
        self.assertIsNone(followup.json()['items'][0]['project'])
        self.assertNotIn('Hidden project name', detail.text + followup.text)
        form = detail.json()['minutes_form']
        form['topics'][0]['discussion'] = 'Edited without project permission'
        saved = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes_form': form})
        self.assertEqual(saved.status_code, 200, saved.text)
        meeting.invalidate_recordset(['minutes_form_data'])
        self.assertEqual(meeting.minutes_form_data['topics'][0]['project_id'], project.id)
