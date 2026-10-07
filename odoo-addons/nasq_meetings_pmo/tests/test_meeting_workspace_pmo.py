# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_pmo.tests.common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingWorkspaceProjects(NasqPmoCase):
    """Minutes topics with projects and snapshots of converted tasks (the meetings/PMO bridge)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= (
            cls.env.ref('nasq_meetings.group_cap_meetings_read')
            | cls.env.ref('nasq_meetings.group_cap_meetings_create')
            | cls.env.ref('nasq_pmo.group_cap_pmo_projects_read')
            | cls.env.ref('nasq_pmo.group_cap_pmo_tasks_read')
        )
        permissions = cls.env['nasq.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create', 'pmo.projects.read', 'pmo.tasks.read']),
        ])
        role = cls.env['nasq.access.role'].create({
            'key': 'meeting_workspace_editor',
            'name_ar': 'محرر مساحة الاجتماعات',
            'name_en': 'Meeting workspace editor',
            'type': 'custom',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.employee.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })
        cls.outsider = new_test_user(
            cls.env, login='meeting_workspace_outsider', password='meeting_workspace_outsider_pass',
            name='Workspace outsider', groups='nasq_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        cls.outsider.group_ids |= cls.env.ref('nasq_meetings.group_cap_meetings_read')
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.outsider.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })

    def _authenticate_employee(self):
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _meeting(self, **values):
        vals = {
            'name': 'Workspace review',
            'state': 'draft',
            'organizer_id': self.employee.id,
            'meeting_date': '2026-09-09',
        }
        vals.update(values)
        return self.env['cyan.meeting.minute'].create(vals)

    def test_invalid_form_does_not_commit_ordinary_patch_and_foreign_access_is_denied(self):
        meeting = self._meeting()
        other = self._meeting(name='Foreign meeting')
        foreign_resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': other.id, 'name': 'Foreign recommendation',
            'responsible_id': self.employee.id, 'execution_period': 'مستمر',
        })
        self._authenticate_employee()
        invalid_form = {
            'opening': '', 'closing': '', 'chairperson': '',
            'approver_name': '', 'approver_title': '', 'unsupported': [],
        }
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'name': 'Should roll back', 'minutes_form': invalid_form,
        })
        self.assertEqual(response.status_code, 422, response.text)
        meeting.invalidate_recordset()
        self.assertEqual(meeting.name, 'Workspace review')
        form = {
            'opening': '', 'closing': '', 'chairperson': '',
            'approver_name': '', 'approver_title': '',
            'topics': [{
                'key': 'foreign', 'title': 'Foreign', 'discussion': '',
                'project_id': None, 'resolution_ids': [foreign_resolution.id],
            }],
        }
        denied = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes_form': form})
        self.assertEqual(denied.status_code, 422, denied.text)
        foreign_company = self.env['res.company'].create({'name': 'Workspace foreign company'})
        foreign_project = self.env['project.project'].create({
            'name': 'Foreign project', 'company_id': foreign_company.id,
        })
        foreign_project_form = dict(form, topics=[{
            'key': 'foreign-project', 'title': 'Foreign project', 'discussion': '',
            'project_id': foreign_project.id, 'resolution_ids': [],
        }])
        project_denied = self.api(
            'PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes_form': foreign_project_form},
        )
        self.assertEqual(project_denied.status_code, 403, project_denied.text)

    def test_version_and_latest_snapshot_keep_captured_task_state(self):
        meeting = self._meeting()
        project = self.env['project.project'].create({
            'name': 'Workspace task project', 'company_id': self.env.company.id,
        })
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Captured task',
            'responsible_id': self.employee.id, 'deadline': '2026-09-30',
        })
        task = resolution.action_convert_to_task(project.id)
        meeting.write({'state': 'confirmed'})
        meeting.write({'state': 'done'})
        task.write({'state': '1_done'})
        meeting.invalidate_recordset(['minutes_snapshot'])
        self.assertEqual(meeting.minutes_snapshot['resolutions'][0]['state'], 'in_progress')
        self._authenticate_employee()
        response = self.api('GET', f'/api/v1/meetings/{meeting.id}/versions')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['items'][0]['snapshot']['resolutions'][0]['state'], 'in_progress')
