# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectSchedule(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project.write({
            'company_id': cls.env.company.id,
            'user_id': cls.manager.id,
        })
        cls.task_overdue.invalidate_recordset(['company_id'])
        cls.task_done.invalidate_recordset(['company_id'])
        cls.task_other.invalidate_recordset(['company_id'])

    def test_set_schedule_round_trips_date_only_and_can_clear_both(self):
        task = self.task_overdue.with_user(self.manager)
        task._liwan_set_schedule(date(2030, 2, 1), date(2030, 2, 4))
        self.assertEqual(task.liwan_planned_start, date(2030, 2, 1))
        self.assertEqual(task.date_deadline.date(), date(2030, 2, 4))
        task._liwan_set_schedule(False, False)
        self.assertFalse(task.liwan_planned_start)
        self.assertFalse(task.date_deadline)

    def test_set_schedule_rejects_inverted_and_partial_dates(self):
        task = self.task_overdue.with_user(self.manager)
        with self.assertRaises(ValidationError):
            task._liwan_set_schedule(date(2030, 2, 5), date(2030, 2, 4))
        with self.assertRaises(ValidationError):
            task._liwan_set_schedule(date(2030, 2, 5), False)
        with self.assertRaises(ValidationError):
            task._liwan_set_schedule(datetime(2030, 2, 1), date(2030, 2, 4))

    def test_ordinary_user_and_direct_orm_schedule_write_are_denied(self):
        task = self.task_overdue.with_user(self.employee)
        with self.assertRaises(AccessError):
            task._liwan_set_schedule(date(2030, 2, 1), date(2030, 2, 4))
        with self.assertRaises(AccessError):
            task.write({'liwan_planned_start': date(2030, 2, 1)})

    def test_context_default_and_copy_cannot_populate_schedule(self):
        Task = self.env['project.task'].with_user(self.employee)
        with self.assertRaises(AccessError):
            Task.with_context(
                default_liwan_planned_start='2030-02-01',
            ).create({
                'name': 'Context schedule', 'project_id': self.project.id,
                'date_deadline': '2030-02-04 00:00:00',
            })
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Context schedule')]))
        with self.assertRaises(AccessError):
            Task.with_context(default_liwan_planned_start='2030-02-01').create([
                {'name': 'Batch schedule 1', 'project_id': self.project.id},
                {'name': 'Batch schedule 2', 'project_id': self.project.id},
            ])
        self.task_overdue.with_user(self.manager)._liwan_set_schedule(date(2030, 2, 1), date(2030, 2, 4))
        # Generic employee copy already rejects stock fields outside the LiwanOS
        # create whitelist; scheduling must not weaken that existing boundary.
        with self.assertRaises(AccessError):
            self.task_overdue.with_user(self.employee).copy()
        copied = self.task_overdue.copy()
        self.assertFalse(copied.liwan_planned_start)

    def test_create_rejects_explicit_schedule_field_for_non_superuser(self):
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.employee).create({
                'name': 'Explicit schedule', 'project_id': self.project.id,
                'liwan_planned_start': date(2030, 2, 1),
                'date_deadline': '2030-02-04 00:00:00',
            })

    def test_schedule_http_manager_read_write_and_invalid_dates(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        url = f'/api/v1/projects/{self.project.id}/schedule'
        response = self.api('GET', url)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['project_id'], self.project.id)
        self.assertIn('tasks', response.json())
        patch_url = f'{url}/tasks/{self.task_overdue.id}'
        response = self.api('PATCH', patch_url, {'start': '2030-02-01', 'end': '2030-02-04'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()['start'], response.json()['end']), ('2030-02-01', '2030-02-04'))
        self.assertEqual(self.api('PATCH', patch_url, {'start': None, 'end': None}).status_code, 200)
        self.assertEqual(self.api('PATCH', patch_url, {'start': '2030-02-05', 'end': '2030-02-04'}).status_code, 422)
        self.assertEqual(self.api('PATCH', patch_url, {'start': False, 'end': None}).status_code, 422)
        self.assertEqual(self.api('PATCH', patch_url, {'start': '2030-02-01'}).status_code, 422)

    def test_schedule_milestones_report_whether_they_are_reached(self):
        milestones = self.env['project.milestone'].create([
            {'name': 'Reached', 'project_id': self.project.id, 'deadline': '2030-02-01', 'is_reached': True},
            {'name': 'Open', 'project_id': self.project.id, 'deadline': '2030-03-01'},
        ])
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/projects/{self.project.id}/schedule').json()
        by_id = {item['id']: item for item in body['milestones']}
        self.assertEqual(set(by_id[milestones[0].id]), {'id', 'name', 'start_date', 'deadline', 'is_reached'})
        self.assertIs(by_id[milestones[0].id]['is_reached'], True)
        self.assertIs(by_id[milestones[1].id]['is_reached'], False)

    def test_schedule_http_ordinary_user_denial_and_task_project_mismatch(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/projects/{self.project.id}/schedule/tasks/{self.task_overdue.id}'
        response = self.api('PATCH', url, {'start': '2030-02-01', 'end': '2030-02-04'})
        self.assertEqual(response.status_code, 403, response.text)
        other = self.env['project.project'].create({
            'name': 'Schedule other', 'company_id': self.env.company.id,
            'user_id': self.manager.id,
        })
        other_task = self.env['project.task'].create({'name': 'Other task', 'project_id': other.id})
        response = self.api('PATCH', f'/api/v1/projects/{self.project.id}/schedule/tasks/{other_task.id}', {
            'start': '2030-02-01', 'end': '2030-02-04',
        })
        self.assertEqual(response.status_code, 404, response.text)

    def test_schedule_http_hides_invisible_dependency_and_rejects_foreign_project(self):
        visible = self.env['project.task'].create({'name': 'Visible predecessor', 'project_id': self.project.id})
        hidden_project = self.env['project.project'].create({
            'name': 'Hidden schedule', 'company_id': self.env.company.id,
            'privacy_visibility': 'followers', 'user_id': self.manager.id,
        })
        hidden = self.env['project.task'].create({'name': 'Hidden predecessor', 'project_id': hidden_project.id})
        task = self.env['project.task'].create({
            'name': 'Dependency target', 'project_id': self.project.id,
            'depend_on_ids': [(6, 0, [visible.id, hidden.id])],
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/projects/{self.project.id}/schedule').json()
        target = next(item for item in body['tasks'] if item['id'] == task.id)
        self.assertIn(visible.id, target['dependency_ids'])
        self.assertNotIn(hidden.id, target['dependency_ids'])
        response = self.api('GET', f'/api/v1/projects/{hidden_project.id}/schedule')
        self.assertEqual(response.status_code, 403, response.text)
        foreign = self.env['project.project'].create({'name': 'Foreign', 'company_id': False})
        response = self.api('GET', f'/api/v1/projects/{foreign.id}/schedule')
        self.assertEqual(response.status_code, 403, response.text)
        company_b = self.env['res.company'].create({'name': 'Schedule foreign company'})
        foreign_company = self.env['project.project'].create({
            'name': 'Foreign company schedule', 'company_id': company_b.id,
        })
        response = self.api('GET', f'/api/v1/projects/{foreign_company.id}/schedule')
        # Another company's project is not-found, not forbidden.
        self.assertEqual(response.status_code, 404, response.text)

    def test_generic_deadline_write_cannot_invert_existing_schedule(self):
        task = self.task_overdue.with_user(self.manager)
        task._liwan_set_schedule(date(2030, 2, 1), date(2030, 2, 4))
        with self.assertRaises(ValidationError):
            task.write({'date_deadline': datetime(2030, 1, 31)})
        with self.assertRaises(ValidationError):
            task.write({'date_deadline': False})
