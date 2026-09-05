# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

PROJECT_KEYS = {'id', 'name', 'status', 'progress', 'task_count', 'closed_task_count', 'active', 'can_manage'}
DETAIL_KEYS = PROJECT_KEYS | {'stages', 'description_html', 'manager', 'privacy_visibility', 'date_start', 'date_end', 'tags', 'followers_count', 'milestone_count'}


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

    def test_can_list_archived_flag(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/projects').json()
        self.assertEqual(set(body), {'items', 'can_create', 'can_list_archived'})
        self.assertFalse(body['can_list_archived'])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', '/api/v1/projects').json()
        self.assertEqual(set(body), {'items', 'can_create', 'can_list_archived'})
        self.assertTrue(body['can_list_archived'])

    def test_list_full_shape_and_progress(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects').json()['items']
        mine = next(p for p in items if p['id'] == self.project.id)
        self.assertEqual(set(mine), PROJECT_KEYS)
        self.assertIsNone(mine['status'], 'to_define is null on the wire')
        # Fixtures: task_overdue (open), task_done (closed), task_other (open) → 1 of 3.
        self.assertEqual((mine['task_count'], mine['closed_task_count'], mine['progress']), (3, 1, 33))
        self.assertNotIn(self.private.id, [p['id'] for p in items])
        self.assertEqual([p['name'] for p in items], sorted(p['name'] for p in items))

    def test_list_unknown_query_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?foo=1')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_detail_stages_and_can_manage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/projects/{self.project.id}').json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertFalse(body['can_manage'])
        # The three fixture tasks (NasqPmoCase.setUpClass) are created before stages A/B
        # exist on this project, so project.task's _compute_stage_id (depends only on
        # project_id) finds no matching stage at create time and leaves stage_id empty;
        # it never recomputes when stages are added afterwards. Both A and B stay empty.
        self.assertEqual(body['stages'], [
            {'id': self.stage_a.id, 'name': 'A', 'sequence': 10, 'fold': True, 'task_count': 0},
            {'id': self.stage_b.id, 'name': 'B', 'sequence': 20, 'fold': False, 'task_count': 0},
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

    def test_create_policy_and_shape(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertFalse(self.api('GET', '/api/v1/projects').json()['can_create'])
        res = self.api('POST', '/api/v1/projects', {'name': 'Nope'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'create_forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])
        res = self.api('POST', '/api/v1/projects', {'name': 'Fresh'})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual([s['name'] for s in body['stages']], ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])
        self.assertEqual(body['manager']['id'], self.manager.id)
        self.assertEqual(body['privacy_visibility'], 'employees')
        self.assertEqual(self.api('POST', '/api/v1/projects', {'name': ' '}).status_code, 422)

    def test_patch_whitelist(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        tag = self.env['project.tags'].create({'name': 't1'})
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {
            'name': 'Renamed', 'description': '<p>d</p>', 'user_id': self.employee.id, 'privacy_visibility': 'followers',
            'date_start': '2030-01-01', 'date': None, 'tag_ids': [tag.id],
        })
        self.assertEqual(res.status_code, 200)
        body = res.json()
        # project.project.write() (core, project_project.py) treats date_start/date as a pair:
        # writing one to a value while the other is explicitly cleared (or was never set) nulls
        # both rather than leaving a half-open range. The project starts with neither date set,
        # so this PATCH (date_start set, date cleared) ends up clearing both.
        self.assertEqual((body['name'], body['description_html'], body['manager']['id'], body['privacy_visibility'], body['date_start'], body['date_end']),
                         ('Renamed', '<p>d</p>', self.employee.id, 'followers', None, None))
        self.assertEqual([t['name'] for t in body['tags']], ['t1'])
        for bad in ({'active': False}, {'privacy_visibility': 'portal'}, {'date_start': 'x'}, {'user_id': 999999}, {'name': ''}):
            self.assertEqual(self.api('PATCH', f'/api/v1/projects/{self.project.id}', bad).status_code, 422, bad)
        self.authenticate('api_emp', 'api_emp_pass_123')
        # api_emp is now the assigned manager (user_id) → allowed even outside the group
        self.assertEqual(self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'name': 'Mine'}).status_code, 200)
        other = self.env['project.project'].create({'name': 'Not mine'})
        res = self.api('PATCH', f'/api/v1/projects/{other.id}', {'name': 'x'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_patch_invalid_tags_description_and_booleans(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'tag_ids': [999999]})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'tag_ids'))
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'description': 42})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'description'))
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'user_id': True})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'user_id'))

    def test_patch_manage_check_precedes_validation(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        other = self.env['project.project'].create({'name': 'Not mine either'})
        res = self.api('PATCH', f'/api/v1/projects/{other.id}', {'user_id': 999999})
        self.assertEqual(res.status_code, 403)

    def test_archived_filter_invalid_value(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('GET', '/api/v1/projects?archived=yes')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'archived'))

    def test_archive_and_archived_filter(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', f'/api/v1/projects/{self.project.id}/archive')
        self.assertEqual((res.status_code, res.json()['active']), (200, False))
        self.assertNotIn(self.project.id, [p['id'] for p in self.api('GET', '/api/v1/projects').json()['items']])
        archived = self.api('GET', '/api/v1/projects?archived=1').json()['items']
        self.assertIn(self.project.id, [p['id'] for p in archived])
        self.assertEqual(self.api('POST', f'/api/v1/projects/{self.project.id}/unarchive').json()['active'], True)
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?archived=1')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
