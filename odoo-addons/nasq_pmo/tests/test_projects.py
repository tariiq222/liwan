# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT

PROJECT_KEYS = {'id', 'name', 'status', 'progress', 'task_count', 'closed_task_count', 'active', 'can_manage', 'allowed_actions', 'manager', 'date_end', 'charter_state'}
DETAIL_KEYS = PROJECT_KEYS | {
    'stages', 'description_html', 'privacy_visibility', 'date_start', 'tags',
    'followers_count', 'milestone_count', 'allow_task_dependencies',
    'completion_approval', 'completion_approver', 'updated_at', 'charter',
}


@tagged('post_install', '-at_install', 'nasq')
class TestProjects(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Stage = cls.env['project.task.type']
        cls.stage_b = Stage.create({'name': 'B', 'sequence': 20, 'project_ids': [(4, cls.project.id)]})
        cls.stage_a = Stage.create({'name': 'A', 'sequence': 10, 'fold': True, 'project_ids': [(4, cls.project.id)]})
        cls.private = cls.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.project_creators', 'managers')
        params.set_param('nasq_pmo.default_stages', False)

    def test_minimal_unchanged(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
        self.assertEqual(set(items[0]), {'id', 'name'})

    def test_can_list_archived_flag(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/projects').json()
        self.assertEqual(set(body), {'items', 'total', 'can_create', 'can_list_archived'})
        self.assertFalse(body['can_list_archived'])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', '/api/v1/projects').json()
        self.assertEqual(set(body), {'items', 'total', 'can_create', 'can_list_archived'})
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

    def test_list_carries_existing_manager_and_end_date(self):
        self.project.write({'user_id': self.manager.id, 'date_start': '2030-01-01', 'date': '2030-12-31'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects').json()['items']
        row = next(p for p in items if p['id'] == self.project.id)
        self.assertEqual(row['manager'], {'id': self.manager.id, 'name': self.manager.name})
        self.assertEqual(row['date_end'], '2030-12-31')
        self.project.write({'user_id': False, 'date': False})
        row = next(p for p in self.api('GET', '/api/v1/projects').json()['items'] if p['id'] == self.project.id)
        self.assertIsNone(row['manager'])
        self.assertIsNone(row['date_end'])

    def test_list_unknown_query_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?foo=1')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_mine_filters_before_pagination_and_preserves_visibility(self):
        Project = self.env['project.project']
        mine = Project.create([
            {'name': f'Mine {index}', 'user_id': self.employee.id, 'privacy_visibility': 'employees'}
            for index in ('A', 'B', 'C')
        ])
        other = Project.create({'name': 'Mine Other Manager', 'user_id': self.manager.id, 'privacy_visibility': 'employees'})
        hidden = Project.create({'name': 'Mine Hidden', 'user_id': self.manager.id, 'privacy_visibility': 'followers'})

        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?mine=1&sort=name&limit=1&offset=1')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['total'], len(mine))
        self.assertEqual([item['id'] for item in body['items']], [mine[1].id])
        self.assertNotIn(other.id, [item['id'] for item in body['items']])
        self.assertNotIn(hidden.id, [item['id'] for item in body['items']])

        unscoped = self.api('GET', '/api/v1/projects?mine=false&limit=200').json()
        absent = self.api('GET', '/api/v1/projects?limit=200').json()
        self.assertEqual(unscoped['total'], absent['total'])
        self.assertIn(other.id, [item['id'] for item in unscoped['items']])
        self.assertNotIn(hidden.id, [item['id'] for item in unscoped['items']])

    def test_list_mine_rejects_unsupported_values(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for value in ('yes', '2', ''):
            res = self.api('GET', f'/api/v1/projects?mine={value}')
            self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'mine'))

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
        self.assertEqual(self.api('POST', '/api/v1/projects', {'name': 'Fresh'}).status_code, 422)
        res = self.api('POST', '/api/v1/projects', {'name': 'Fresh', 'date_end': '2030-12-31'})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual(self.env['project.project'].browse(body['id']).company_id, self.env.company)
        self.assertEqual([s['name'] for s in body['stages']], ['جديد', 'قيد التنفيذ', 'مراجعة', 'منجز'])
        self.assertEqual(body['manager']['id'], self.manager.id)
        self.assertEqual(body['date_end'], '2030-12-31')
        self.assertIsNone(body['date_start'])
        self.assertEqual(body['privacy_visibility'], 'employees')
        self.assertEqual(body['completion_approval'], 'none')
        self.assertEqual(body['updated_at'], 'v1')
        self.assertEqual(body['charter']['budget_state'], 'unknown')
        self.assertEqual(self.api('POST', '/api/v1/projects', {'name': ' '}).status_code, 422)

    def test_create_at_project_quota_preserves_limit_error_and_usage(self):
        service = self.env['nasq.entitlement.service'].sudo()
        profile = self.env.ref('nasq_platform.tenant_profile')
        project_count = service._nasq_count_projects()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'projects.max_projects': project_count},
        })
        quota_revision = profile.quota_revision

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])
        res = self.api('POST', '/api/v1/projects', {
            'name': 'Over project quota', 'date_end': '2030-12-31',
        })

        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'feature_not_included')
        self.assertEqual(res.json()['details'], {
            'reason': 'limit', 'limit_key': 'projects.max_projects',
        })
        self.assertEqual(service._nasq_count_projects(), project_count)
        profile.invalidate_recordset(['quota_revision'])
        self.assertEqual(profile.quota_revision, quota_revision)

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

    def test_patch_dependency_feature_requires_manager_and_boolean(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'allow_task_dependencies': True})
        self.assertEqual(res.status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'allow_task_dependencies': 'yes'})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'allow_task_dependencies'))
        res = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'allow_task_dependencies': True})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['allow_task_dependencies'])

    def test_list_invalid_limit_offset_and_status(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/projects?limit=-1')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'limit'))
        res = self.api('GET', '/api/v1/projects?offset=abc')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'offset'))
        res = self.api('GET', '/api/v1/projects?status=purple')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'status'))
        res = self.api('GET', '/api/v1/projects?status=to_define')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'status'))

    def test_list_pagination_filters_and_visibility(self):
        Project = self.env['project.project']
        bulk = Project.create([{'name': f'WP4 Bulk {i:03d}'} for i in range(201)])
        tracked = bulk[200]
        tracked.write({'last_update_status': 'on_track'})
        hidden = Project.create({'name': 'WP4 Hidden Private', 'privacy_visibility': 'followers'})

        self.authenticate('api_emp', 'api_emp_pass_123')
        capped = self.api('GET', '/api/v1/projects?q=WP4%20Bulk').json()
        self.assertEqual(set(capped), {'items', 'total', 'can_create', 'can_list_archived'})
        self.assertEqual(capped['total'], 201)
        self.assertEqual(len(capped['items']), 200)
        self.assertNotIn(hidden.id, [p['id'] for p in capped['items']])
        self.assertEqual(self.api('GET', '/api/v1/projects?q=WP4%20Hidden').json()['total'], 0)

        over_cap = self.api('GET', '/api/v1/projects?q=WP4%20Bulk&limit=500').json()
        self.assertEqual(len(over_cap['items']), 200)
        self.assertEqual(over_cap['total'], 201)

        # limit=0 is Odoo-unlimited; normalize to MAX_PROJECTS so 201 rows stay capped.
        zero = self.api('GET', '/api/v1/projects?q=WP4%20Bulk&limit=0').json()
        self.assertEqual(set(zero), {'items', 'total', 'can_create', 'can_list_archived'})
        self.assertEqual(len(zero['items']), 200)
        self.assertEqual(zero['total'], 201)
        zero_min = self.api('GET', '/api/v1/projects?minimal=1&q=WP4%20Bulk&limit=0').json()
        self.assertIsInstance(zero_min, list)
        self.assertEqual(len(zero_min), 200)

        page = self.api('GET', '/api/v1/projects?q=WP4%20Bulk%2015&limit=5&offset=5').json()
        self.assertEqual(page['total'], 10)
        self.assertEqual(len(page['items']), 5)
        self.assertEqual([p['name'] for p in page['items']], [f'WP4 Bulk {i:03d}' for i in range(155, 160)])

        empty_tail = self.api('GET', '/api/v1/projects?q=WP4%20Bulk%2015&limit=5&offset=10').json()
        self.assertEqual(empty_tail['total'], 10)
        self.assertEqual(empty_tail['items'], [])

        beyond_first = self.api('GET', '/api/v1/projects?q=WP4%20Bulk&status=on_track').json()
        self.assertEqual(beyond_first['total'], 1)
        self.assertEqual([p['id'] for p in beyond_first['items']], [tracked.id])

        unset = self.api('GET', '/api/v1/projects?q=WP4%20Bulk%20200&status=unset').json()
        self.assertEqual(unset['total'], 0)
        unset_ok = self.api('GET', '/api/v1/projects?q=WP4%20Bulk%20000&status=unset').json()
        self.assertEqual(unset_ok['total'], 1)
        self.assertIsNone(unset_ok['items'][0]['status'])

        refs = self.api('GET', '/api/v1/projects?minimal=1&q=WP4%20Bulk&limit=200&offset=0').json()
        self.assertIsInstance(refs, list)
        self.assertEqual(len(refs), 200)
        self.assertEqual(set(refs[0]), {'id', 'name'})
        rest = self.api('GET', '/api/v1/projects?minimal=1&q=WP4%20Bulk&limit=200&offset=200').json()
        self.assertIsInstance(rest, list)
        self.assertEqual(len(rest), 1)
        self.assertEqual(rest[0]['id'], tracked.id)

    def test_audit_sort_before_pagination(self):
        projects = self.env['project.project'].create([
            {'name': f'Audit Sort {name}', 'privacy_visibility': 'employees',
             'company_id': self.env.company.id}
            for name in ['A Open', 'B Half', 'C Done', 'D Private']
        ])
        projects[3].privacy_visibility = 'followers'
        for project, states in zip(projects, [
            ['01_in_progress'], ['01_in_progress', '1_done'], ['1_done'], ['1_done'],
        ]):
            self.env['project.task'].create([
                {'name': 'Sort task', 'project_id': project.id, 'state': state}
                for state in states
            ])
        self.authenticate('api_emp', 'api_emp_pass_123')
        path = '/api/v1/projects?q=Audit%20Sort&sort=progress&limit=1'
        first = self.api('GET', path)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()['total'], 3)
        pages = [first.json()['items']]
        pages.extend(self.api('GET', path + f'&offset={n}').json()['items'] for n in [1, 2])
        self.assertEqual([page[0]['id'] for page in pages], [projects[2].id, projects[1].id, projects[0].id])
        self.assertEqual([page[0]['progress'] for page in pages], [100, 50, 0])
        by_name = self.api('GET', '/api/v1/projects?q=Audit%20Sort&sort=name&limit=1&offset=1')
        self.assertEqual(by_name.json()['items'][0]['id'], projects[1].id)
        invalid = self.api('GET', '/api/v1/projects?sort=unsafe')
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()['field'], 'sort')
