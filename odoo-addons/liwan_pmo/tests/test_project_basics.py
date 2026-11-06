# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_pmo.serializers.project import dump_project_detail


@tagged('post_install', '-at_install', 'liwan')
class TestProjectBasics(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def test_core_create_and_objectives_without_charter(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('POST', '/api/v1/projects', {
            'name': 'Simple project', 'success_criteria': 'Twenty orders in a month',
            'objectives': [{'goal': 'Launch', 'metric': 'orders', 'target': '20'}, {'goal': 'Support'}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertIsNone(body['charter'])
        self.assertIsNone(body['phase_state'])
        self.assertEqual(len(body['objectives']), 2)
        self.assertEqual(body['success_criteria'], 'Twenty orders in a month')
        self.assertIsNone(body['date_end'])
        self.assertEqual(body['manager']['id'], self.manager.id)
        self.assertNotIn('liwan_objectives', self.env['project.project']._fields)
        self.env.cr.execute("SELECT column_name FROM information_schema.columns WHERE table_name='project_project' AND column_name='liwan_objectives'")
        self.assertFalse(self.env.cr.fetchall())

    def test_atomic_objective_replacement_and_stale_write(self):
        self.project.write({'user_id': self.manager.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        path = f'/api/v1/projects/{self.project.id}'
        first = self.api('GET', path).json()
        token = first['updated_at']
        missing = self.api('PATCH', path, {'objectives': [{'goal': 'Launch'}]})
        self.assertEqual(missing.status_code, 422)
        response = self.api('PATCH', path, {'expected_updated_at': token, 'objectives': [{'goal': 'One'}, {'goal': 'Two'}]})
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()
        stale = self.api('PATCH', path, {'expected_updated_at': token, 'objectives': []})
        self.assertEqual(stale.status_code, 409)
        invalid = self.api('PATCH', path, {'expected_updated_at': updated['updated_at'], 'objectives': [{'goal': 'Valid'}, {'goal': ' '}]})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(len(self.api('GET', path).json()['objectives']), 2)
        response = self.api('PATCH', path, {'expected_updated_at': updated['updated_at'], 'objectives': []})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['objectives'], [])

    def test_objective_access_follows_project(self):
        row = self.env['liwan.project.objective'].create({'project_id': self.project.id, 'goal': 'Core goal'})
        member = row.with_user(self.employee)
        with self.assertRaises(AccessError):
            member.write({'goal': 'Unauthorized'})
        with self.assertRaises(ValidationError):
            row.write({'project_id': self.project.id})
        self.project.write({'active': False})
        self.assertEqual(member.search([('id', '=', row.id)]), member)
        self.assertEqual(member.read(['goal'])[0]['goal'], 'Core goal')
        with self.assertRaises(AccessError):
            member.write({'goal': 'Archived edit'})

    def test_disabled_blocks_are_redacted(self):
        result = dump_project_detail(self.project)
        self.assertIsNone(result['milestone_count'])
        self.assertFalse(result['allow_task_dependencies'])
        self.assertIsNone(result['charter'])
        self.assertIsNone(result['phase'])

    def test_archived_detail_keeps_objectives_for_members_only(self):
        self.project.write({'user_id': self.manager.id, 'liwan_objective_ids': [(0, 0, {'goal': 'Archived core goal'})]})
        self.project.write({'active': False})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('GET', f'/api/v1/projects/{self.project.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['objectives'][0]['goal'], 'Archived core goal')
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', f'/api/v1/projects/{self.project.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['objectives'][0]['goal'], 'Archived core goal')

    def test_simple_project_tasks_subtasks_and_updates_need_no_charter(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self.api('POST', '/api/v1/projects', {'name': 'Core work'})
        self.assertEqual(created.status_code, 201, created.text)
        project = created.json()
        self.assertIsNone(project['charter'])
        task = self.api('POST', '/api/v1/tasks', {'name': 'Core task', 'project_id': project['id']})
        self.assertEqual(task.status_code, 201, task.text)
        child = self.api('POST', '/api/v1/tasks', {'name': 'Core child', 'project_id': project['id'], 'parent_id': task.json()['id']})
        self.assertEqual(child.status_code, 201, child.text)
        update = self.api('POST', f"/api/v1/projects/{project['id']}/updates", {'name': 'First update', 'description': 'Working'})
        self.assertEqual(update.status_code, 201, update.text)
        self.assertIsNone(self.api('GET', f"/api/v1/projects/{project['id']}").json()['charter'])
