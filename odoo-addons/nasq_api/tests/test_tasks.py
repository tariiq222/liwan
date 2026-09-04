# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestTaskRead(NasqApiCase):

    def test_list_requires_mine_filter(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_mine_open_by_default(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['total'], 1)
        item = body['items'][0]
        self.assertEqual(item['id'], self.task_overdue.id)
        self.assertEqual(item['state'], 'in_progress')
        self.assertEqual(item['priority'], '1')
        self.assertTrue(item['is_overdue'])
        self.assertEqual(item['days_remaining'], -3)
        self.assertEqual(item['project'], {'id': self.project.id, 'name': 'Erada Portal'})
        self.assertEqual(item['assignees'], [{'id': self.employee.id, 'name': 'Sara'}])
        self.assertEqual(set(item), {'id', 'name', 'project', 'state', 'priority', 'date_deadline',
                                     'days_remaining', 'is_overdue', 'is_closed', 'personal_stage',
                                     'assignees', 'tags'})

    def test_list_mine_closed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tasks?filter=mine&closed=1').json()
        self.assertEqual([t['id'] for t in body['items']], [self.task_done.id])
        self.assertEqual(body['items'][0]['state'], 'done')

    def test_list_search_and_pagination(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine&q=overdue').json()['total'], 1)
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine&q=zzz').json()['total'], 0)
        body = self.api('GET', '/api/v1/tasks?filter=mine&closed=1&limit=1&offset=1').json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'], [])

    def test_get_detail(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['age_days'], 0)
        self.assertIsNone(body['cycle_days'])
        self.assertFalse(body['can_approve'])
        self.assertEqual(body['subtasks'], [])
        self.assertEqual(body['depends_on'], [])
        self.assertEqual(body['attachments'], [])
        self.assertIn('description_html', body)

    def test_get_other_users_task_is_forbidden_or_hidden(self):
        # employees may read tasks in projects they can see; a task in a private project is 403/404
        private = self.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({'name': 'Secret', 'project_id': private.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertIn(res.status_code, (403, 404))
        self.assertIn(res.json()['code'], ('forbidden', 'not_found'))

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
