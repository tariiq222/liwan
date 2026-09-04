# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

PROJECT_KEYS = {'id', 'name', 'status', 'progress', 'task_count', 'closed_task_count'}
DETAIL_KEYS = PROJECT_KEYS | {'stages', 'can_manage'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjects(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Stage = cls.env['project.task.type']
        cls.stage_b = Stage.create({'name': 'B', 'sequence': 20, 'project_ids': [(4, cls.project.id)]})
        cls.stage_a = Stage.create({'name': 'A', 'sequence': 10, 'fold': True, 'project_ids': [(4, cls.project.id)]})
        cls.private = cls.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})

    def test_minimal_unchanged(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
        self.assertEqual(set(items[0]), {'id', 'name'})

    def test_list_full_shape_and_progress(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects').json()
        mine = next(p for p in items if p['id'] == self.project.id)
        self.assertEqual(set(mine), PROJECT_KEYS)
        self.assertIsNone(mine['status'], 'to_define is null on the wire')
        # Fixtures: task_overdue (open), task_done (closed), task_other (open) → 1 of 3.
        self.assertEqual((mine['task_count'], mine['closed_task_count'], mine['progress']), (3, 1, 33))
        self.assertNotIn(self.private.id, [p['id'] for p in items])
        self.assertEqual([p['name'] for p in items], sorted(p['name'] for p in items))

    def test_list_unknown_query_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?archived=1')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_detail_stages_and_can_manage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/projects/{self.project.id}').json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertFalse(body['can_manage'])
        self.assertEqual(body['stages'], [
            {'id': self.stage_a.id, 'name': 'A', 'sequence': 10, 'fold': True},
            {'id': self.stage_b.id, 'name': 'B', 'sequence': 20, 'fold': False},
        ])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['can_manage'])

    def test_detail_missing_and_unreadable(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/projects/999999').status_code, 404)
        res = self.api('GET', f'/api/v1/projects/{self.private.id}')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_status_manager_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_track'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'status_forbidden')

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'at_risk'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['status'], 'at_risk')
        self.assertEqual(set(res.json()), DETAIL_KEYS)
        self.assertEqual(self.env['project.update'].search([('project_id', '=', self.project.id)]).status, 'at_risk')

    def test_status_invalid_value(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        for bad in ('to_define', 'purple', None, [], {}):
            res = self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': bad})
            self.assertEqual(res.status_code, 422, bad)
            self.assertEqual(res.json()['code'], 'invalid_status')
            self.assertEqual(res.json()['field'], 'status')
