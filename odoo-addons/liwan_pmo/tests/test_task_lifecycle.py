# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_api.controllers.common import DEFAULT_PAGE_LIMIT


@tagged('post_install', '-at_install', 'liwan')
class TestTaskLifecycle(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.project.write({'company_id': company.id})
        cls.task_overdue.write({'company_id': company.id})
        cls.task_done.write({'company_id': company.id})
        cls.task_other.write({'company_id': company.id})
        cls.employee.write({'company_id': company.id})
        cls.manager.write({'company_id': company.id})
        cls.other_project = cls.env['project.project'].create({'name': 'Other project', 'company_id': company.id})
        cls.other_task = cls.env['project.task'].create({
            'name': 'Other task', 'project_id': cls.other_project.id, 'company_id': company.id,
            'user_ids': [(4, cls.manager.id)],
        })
        cls.dependent = cls.env['project.task'].create({
            'name': 'Dependent', 'project_id': cls.project.id, 'company_id': company.id,
            'user_ids': [(4, cls.employee.id)],
        })
        cls.read_only = new_test_user(
            cls.env, login='api_lifecycle_read_only', password='api_lifecycle_read_only_pass',
            name='Lifecycle read only', groups='base.group_user',
        )
        read_only_role = cls.env['liwan.access.role'].create({
            'name_ar': 'قارئ دورة المهام',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.read_only.id, 'role_id': read_only_role.id,
            'company_id': cls.env.company.id,
        })

    def test_dependency_marker_does_not_trust_mixed_task_writes(self):
        marker = self.env.cr.precommit.data
        marker['liwan_pmo.dependency_write_depth'] = 1
        try:
            with self.assertRaises(AccessError):
                self.task_overdue.with_user(self.manager).write({
                    'depend_on_ids': [(6, 0, [])], 'name': 'must remain protected',
                })
        finally:
            marker.pop('liwan_pmo.dependency_write_depth', None)

    def test_dependency_feature_and_manager_capability_are_serialized(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/dependencies').json()
        self.assertEqual(body, {'items': [], 'total': 0, 'can_manage': False, 'enabled': False})
        detail = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertFalse(detail['can_manage_dependencies'])

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertTrue(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/dependencies').json()['can_manage'])
        self.assertFalse(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/dependencies').json()['enabled'])
        self.assertTrue(self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'allow_task_dependencies': True}).json()['allow_task_dependencies'])

    def test_dependency_rejects_self_cross_project_and_duplicate_ids(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        for ids in ([self.dependent.id], [self.other_task.id], [self.dependent.id, self.dependent.id]):
            res = self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': ids})
            self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'ids'))

    def test_dependency_rejects_cycles(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        self.assertEqual(self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': [self.task_overdue.id]}).status_code, 200)
        res = self.api('PUT', f'/api/v1/tasks/{self.task_overdue.id}/dependencies', {'ids': [self.dependent.id]})
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'ids'))

    def test_dependency_rejects_when_disabled_but_allows_clearing(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        self.assertEqual(self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': [self.task_overdue.id]}).status_code, 200)
        self.project.write({'allow_task_dependencies': False})
        res = self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': [self.task_overdue.id]})
        self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'))
        self.assertEqual(self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': []}).status_code, 200)

    def test_dependency_is_manager_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PUT', f'/api/v1/tasks/{self.task_overdue.id}/dependencies', {'ids': []})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_archive_list_uses_creator_scope_and_total(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self.api('POST', '/api/v1/tasks', {'name': 'Creator archive', 'project_id': self.project.id})
        self.assertEqual(created.status_code, 201)
        task_id = created.json()['id']
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{task_id}/archive', {}).status_code, 200)
        body = self.api('GET', '/api/v1/tasks/archived?filter=mine').json()
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['items'][0]['id'], task_id)
        paged = self.api('GET', '/api/v1/tasks/archived?filter=mine&limit=1&offset=1').json()
        self.assertEqual((paged['total'], paged['items']), (1, []))
        self.assertEqual(set(body['items'][0]), {
            'id', 'name', 'description_excerpt', 'project', 'state', 'priority', 'date_deadline', 'days_remaining',
            'is_overdue', 'is_closed', 'personal_stage', 'stage', 'assignees', 'tags',
            'can_write', 'can_approve', 'allowed_transitions',
            'subtask_count', 'subtask_done_count', 'attachment_count',
        })

    def test_creator_can_restore_but_archived_project_blocks_restore(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self.api('POST', '/api/v1/tasks', {'name': 'Restore me', 'project_id': self.project.id})
        task_id = created.json()['id']
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{task_id}/archive', {}).status_code, 200)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/projects/{self.project.id}/archive').status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{task_id}/unarchive')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'archived_project'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/projects/{self.project.id}/unarchive').status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{task_id}/unarchive').status_code, 200)

    def test_unarchive_is_not_visible_to_unrelated_creator(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/archive').status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/unarchive')
        self.assertEqual(res.status_code, 404)

    def test_archive_list_and_restore_require_task_write_capability(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/archive').status_code, 200)
        self.authenticate(self.read_only.login, 'api_lifecycle_read_only_pass')
        body = self.api('GET', f'/api/v1/tasks/archived?project_id={self.project.id}').json()
        self.assertEqual(body, {'items': [], 'total': 0})
        self.assertEqual(
            self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/unarchive').status_code,
            404,
        )

    def test_dependency_detail_filters_unreadable_prerequisite(self):
        private = self.env['project.project'].create({
            'name': 'Followers only', 'privacy_visibility': 'followers', 'user_id': self.manager.id,
            'allow_task_dependencies': True, 'company_id': self.env.company.id,
        })
        visible = self.env['project.task'].create({
            'name': 'Visible dependent', 'project_id': private.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)],
        })
        hidden = self.env['project.task'].create({
            'name': 'Hidden prerequisite', 'project_id': private.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.manager.id)],
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('PUT', f'/api/v1/tasks/{visible.id}/dependencies', {'ids': [hidden.id]}).status_code, 200)
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{visible.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['depends_on'], [])

    def test_dependency_candidates_are_searchable_and_paginated(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        res = self.api('GET', f'/api/v1/tasks/{self.dependent.id}/dependencies/candidates?limit=1&offset=0')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(len(body['items']), 1)
        self.assertGreaterEqual(body['total'], 2)
        self.assertNotIn(self.dependent.id, [item['id'] for item in body['items']])
        res = self.api('GET', f'/api/v1/tasks/{self.dependent.id}/dependencies/candidates?q=Overdue')
        self.assertEqual([item['id'] for item in res.json()['items']], [self.task_overdue.id])

    def test_zero_limit_lists_the_default_page_of_dependency_candidates(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        self.env['project.task'].create([
            {'name': f'Zero limit candidate {index:03d}', 'project_id': self.project.id,
             'company_id': self.env.company.id}
            for index in range(DEFAULT_PAGE_LIMIT + 1)
        ])
        url = f'/api/v1/tasks/{self.dependent.id}/dependencies/candidates'
        body = self.api('GET', f'{url}?limit=0').json()
        self.assertEqual(len(body['items']), DEFAULT_PAGE_LIMIT)
        self.assertGreater(body['total'], DEFAULT_PAGE_LIMIT)
        # A missing limit is the same default page, not an unbounded list.
        self.assertEqual(len(self.api('GET', url).json()['items']), DEFAULT_PAGE_LIMIT)

    def test_dependency_unblocks_waiting_task_when_prerequisite_closes(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'allow_task_dependencies': True})
        self.assertEqual(self.api('PUT', f'/api/v1/tasks/{self.dependent.id}/dependencies', {'ids': [self.task_overdue.id]}).status_code, 200)
        self.assertEqual(self.dependent.state, '04_waiting_normal')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/transition', {'state': 'done'}).status_code, 200)
        self.assertEqual(self.dependent.state, '01_in_progress')

    def test_archived_project_tasks_are_excluded_from_archive_list(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_other.id}/archive', {}).status_code, 200)
        self.assertEqual(self.api('POST', f'/api/v1/projects/{self.other_project.id}/archive', {}).status_code, 200)
        body = self.api('GET', f'/api/v1/tasks/archived?project_id={self.other_project.id}').json()
        self.assertEqual(body, {'items': [], 'total': 0})

    def test_archive_list_paginates_after_eligibility_with_stable_total_and_order(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created_ids = []
        for index in range(3):
            created = self.api('POST', '/api/v1/tasks', {
                'name': f'WP7 Archive page {index}', 'project_id': self.project.id,
            })
            self.assertEqual(created.status_code, 201)
            task_id = created.json()['id']
            self.assertEqual(self.api('POST', f'/api/v1/tasks/{task_id}/archive', {}).status_code, 200)
            created_ids.append(task_id)
        query = 'WP7 Archive page'
        pages = [
            self.api(
                'GET',
                f'/api/v1/tasks/archived?project_id={self.project.id}&q={query}&limit=1&offset={offset}',
            ).json()
            for offset in range(3)
        ]
        self.assertEqual({page['total'] for page in pages}, {3})
        page_ids = [page['items'][0]['id'] for page in pages]
        self.assertEqual(len(page_ids), 3)
        self.assertEqual(set(page_ids), set(created_ids))
        full = self.api(
            'GET',
            f'/api/v1/tasks/archived?project_id={self.project.id}&q={query}&limit=200',
        ).json()
        self.assertEqual(full['total'], 3)
        self.assertEqual([item['id'] for item in full['items']], page_ids)
        empty = self.api(
            'GET',
            f'/api/v1/tasks/archived?project_id={self.project.id}&q={query}&limit=1&offset=3',
        ).json()
        self.assertEqual((empty['total'], empty['items']), (3, []))

    def test_archive_list_hides_cross_company_and_hidden_tasks(self):
        company_b = self.env['res.company'].create({'name': 'Archive company B'})
        self.manager.write({'company_ids': [(4, company_b.id)]})
        project_b = self.env['project.project'].create({
            'name': 'Foreign archive project', 'company_id': company_b.id, 'user_id': self.manager.id,
        })
        foreign = self.env['project.task'].create({
            'name': 'Foreign archived', 'project_id': project_b.id, 'company_id': company_b.id,
            'user_ids': [(4, self.manager.id)], 'active': False,
        })
        hidden_project = self.env['project.project'].create({
            'name': 'Hidden archive project', 'privacy_visibility': 'followers',
            'company_id': self.env.company.id, 'user_id': self.manager.id,
        })
        hidden = self.env['project.task'].create({
            'name': 'Hidden archived', 'project_id': hidden_project.id,
            'company_id': self.env.company.id, 'user_ids': [(4, self.manager.id)], 'active': False,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        mine = self.api('GET', '/api/v1/tasks/archived?filter=mine').json()
        listed_ids = {item['id'] for item in mine['items']}
        self.assertNotIn(foreign.id, listed_ids)
        self.assertNotIn(hidden.id, listed_ids)
        self.assertEqual(
            self.api('POST', f'/api/v1/tasks/{foreign.id}/unarchive').status_code,
            404,
        )
        self.assertEqual(
            self.api('POST', f'/api/v1/tasks/{hidden.id}/unarchive').status_code,
            404,
        )

    def _archive_tasks(self, count, prefix='Archive eligibility'):
        """Archive COUNT tasks created by api_emp, so they are restorable by their creator."""
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = []
        for index in range(count):
            res = self.api('POST', '/api/v1/tasks', {
                'name': f'{prefix} {index}', 'project_id': self.project.id,
            })
            self.assertEqual(res.status_code, 201, res.text)
            task_id = res.json()['id']
            self.assertEqual(self.api('POST', f'/api/v1/tasks/{task_id}/archive', {}).status_code, 200)
            created.append(task_id)
        return created

    def test_archive_list_matches_the_per_record_rule_for_each_actor(self):
        """The domain form of _liwan_can_archive answers exactly what the model method answers.

        The creator reads the archive of their own project, the project manager reads it as the
        approver, and an employee without `pmo.tasks.write` sees nothing of it: the two results are
        compared to the model method over the same project scope, so a domain that widened or
        narrowed eligibility would fail here.
        """
        self.project.write({'user_id': self.manager.id})
        created = self._archive_tasks(3)
        url = f'/api/v1/tasks/archived?project_id={self.project.id}'
        without_write = new_test_user(
            self.env, login='archive_no_write', password='archive_no_write_pass',
            groups='liwan_core.group_employee',
        )
        for login, password in (
            ('api_emp', 'api_emp_pass_123'), ('api_mgr', 'api_mgr_pass_123'),
        ):
            with self.subTest(login=login):
                self.authenticate(login, password)
                body = self.api('GET', url).json()
                user = self.env['res.users'].search([('login', '=', login)])
                Task = self.env['project.task'].with_user(user).with_context(active_test=False)
                expected = Task.browse(created).filtered(lambda task: task._liwan_can_archive()).ids
                self.assertEqual({item['id'] for item in body['items']}, set(expected))
                self.assertEqual(body['total'], len(expected))
        # A reader without the write capability may restore nothing and sees an empty page.
        self.authenticate('archive_no_write', 'archive_no_write_pass')
        self.assertEqual(self.api('GET', url).json(), {'items': [], 'total': 0})
        self.assertFalse(
            self.env['project.task'].with_user(without_write).browse(created[0])._liwan_can_archive(),
        )

    def test_archive_list_pages_in_sql_with_a_stable_total_and_order(self):
        """Paging slices the eligible set in SQL: every page agrees on the total and the order."""
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        created = self._archive_tasks(5, prefix='SQL page')
        query = 'SQL page'
        url = f'/api/v1/tasks/archived?project_id={self.project.id}&q={query}'
        pages = [
            self.api('GET', f'{url}&limit=2&offset={offset}').json()
            for offset in (0, 2, 4)
        ]
        self.assertEqual({page['total'] for page in pages}, {5})
        page_ids = [item['id'] for page in pages for item in page['items']]
        self.assertEqual(sorted(page_ids), sorted(created))
        self.assertEqual(len(page_ids), len(set(page_ids)), 'a page repeated a row')
        full = self.api('GET', f'{url}&limit=200').json()
        self.assertEqual([item['id'] for item in full['items']], page_ids)
        beyond = self.api('GET', f'{url}&limit=2&offset=5').json()
        self.assertEqual((beyond['total'], beyond['items']), (5, []))

    def test_archive_list_cost_does_not_grow_with_the_archive(self):
        """The page cost is the page, not the archive: one task and 300 tasks answer in the same queries.

        The old path fetched every matching id and ran _liwan_can_archive per record before
        slicing, so this count grew with the archive. `sql_log_count` counts every statement of
        the request, the search_count and the page query included.
        """
        self.authenticate('api_emp', 'api_emp_pass_123')
        # One row per page in both measurements, so only the archive size differs: the per-row
        # serialization of the page stays constant, and the eligibility search is SQL either way.
        url = '/api/v1/tasks/archived?filter=mine&limit=1'
        # Warm the route once, so the two measurements compare the same caches.
        self._archive_tasks(1, prefix='Cost warm')
        self.assertEqual(self.api('GET', url).status_code, 200)
        small = self._archive_tasks(1, prefix='Cost small')
        start = self.env.cr.sql_log_count
        self.assertEqual(self.api('GET', url).json()['total'], len(small) + 1)
        one_task_queries = self.env.cr.sql_log_count - start
        large = self._archive_tasks(300, prefix='Cost large')
        start = self.env.cr.sql_log_count
        body = self.api('GET', url).json()
        many_task_queries = self.env.cr.sql_log_count - start
        self.assertEqual(body['total'], len(small) + 1 + len(large))
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(
            many_task_queries, one_task_queries,
            f'{one_task_queries} queries for a 2-task archive but {many_task_queries} for 302',
        )
