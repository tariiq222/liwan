# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase

TASK_KEYS = {'id', 'name', 'project', 'state', 'priority', 'date_deadline',
             'days_remaining', 'is_overdue', 'is_closed', 'personal_stage',
             'assignees', 'tags'}


@tagged('post_install', '-at_install', 'nasq')
class TestTaskRead(NasqApiCase):

    def test_list_requires_mine_filter(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_bad_pagination_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine&limit=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'limit')

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
        self.assertEqual(set(item), TASK_KEYS)

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
        self.assertEqual(set(body), TASK_KEYS | {'description_html', 'allocated_hours', 'age_days',
                                                   'cycle_days', 'subtasks', 'depends_on', 'attachments',
                                                   'can_approve', 'created_at', 'updated_at'})

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


@tagged('post_install', '-at_install', 'nasq')
class TestTaskWrite(NasqApiCase):

    def test_create(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'New one', 'project_id': self.project.id})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body['name'], 'New one')
        self.assertEqual(body['assignees'], [{'id': self.employee.id, 'name': 'Sara'}])
        self.assertEqual(body['state'], 'in_progress')

    def test_create_subtask(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'Child', 'project_id': self.project.id, 'parent_id': self.task_overdue.id})
        self.assertEqual(res.status_code, 201)
        parent = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertEqual([t['name'] for t in parent['subtasks']], ['Child'])

    def test_create_validation(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': '   ', 'project_id': self.project.id})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'name')

    def test_patch_whitelist(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'name': 'Renamed', 'priority': '3'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Renamed')
        self.assertEqual(res.json()['priority'], '3')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'priority': '9'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'priority')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'project_id': 1})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json(), {'code': 'unknown_field', 'message': "field 'project_id' is not writable", 'field': 'project_id'})

    def test_patch_allocated_hours_needs_manager(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'allocated_hours': 4}).status_code, 422)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'allocated_hours': 4})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['allocated_hours'], 4.0)

    def test_patch_deadline_and_stage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        stages = self.api('GET', '/api/v1/me/personal-stages').json()
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}',
                       {'date_deadline': '2030-01-15T09:00:00Z', 'personal_stage_type_id': stages[1]['id']})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['date_deadline'], '2030-01-15T09:00:00Z')
        self.assertEqual(res.json()['personal_stage']['id'], stages[1]['id'])
        self.assertFalse(res.json()['is_overdue'])

    def test_patch_empty_payload_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')

    def test_transition_employee(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/transition', {'state': 'done'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['state'], 'done')
        self.assertTrue(res.json()['is_closed'])
        self.assertIsNotNone(res.json()['cycle_days'])
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/transition', {'state': 'approved'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'transition_forbidden')

    def test_transition_manager_and_invalid(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/transition', {'state': 'approved'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['state'], 'approved')
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/transition', {'state': 'nope'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid_state')
