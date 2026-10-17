# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase
from odoo.addons.webvue_pmo.controllers.task_archive import eligible_archived_task_ids


@tagged('post_install', '-at_install', 'webvue')
class TestTaskLifecycle(WebVuePmoCase):

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
        read_only_role = cls.env['webvue.access.role'].create({
            'name_ar': 'قارئ دورة المهام',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.read_only.id, 'role_id': read_only_role.id,
            'company_id': cls.env.company.id,
        })

    def test_dependency_marker_does_not_trust_mixed_task_writes(self):
        marker = self.env.cr.precommit.data
        marker['webvue_pmo.dependency_write_depth'] = 1
        try:
            with self.assertRaises(AccessError):
                self.task_overdue.with_user(self.manager).write({
                    'depend_on_ids': [(6, 0, [])], 'name': 'must remain protected',
                })
        finally:
            marker.pop('webvue_pmo.dependency_write_depth', None)

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

    def test_archive_eligibility_skips_ineligible_before_pagination(self):
        company = self.env.company
        archived = self.env['project.task'].create([
            {
                'name': f'Eligible skip {index}',
                'project_id': self.project.id,
                'company_id': company.id,
                'user_ids': [(4, self.manager.id)],
                'active': False,
            }
            for index in range(6)
        ])
        Task = self.env['project.task'].with_user(self.manager).with_context(active_test=False)
        domain = [
            ('active', '=', False),
            ('company_id', '=', company.id),
            ('project_id', '=', self.project.id),
            ('id', 'in', archived.ids),
        ]
        allowed = {archived[1].id, archived[3].id, archived[5].id}

        def can_archive(task):
            task.ensure_one()
            return task.id in allowed

        with patch.object(type(Task), '_webvue_can_archive', can_archive):
            eligible_ids = eligible_archived_task_ids(Task, domain, batch_size=4)
        ordered = Task.search(domain, order='write_date desc, id desc').ids
        expected = [task_id for task_id in ordered if task_id in allowed]
        self.assertEqual(list(eligible_ids), expected)
        self.assertEqual(eligible_ids[1:2], expected[1:2])

    def test_archive_scan_batch_load_is_bounded_and_matches_filtered_search(self):
        company = self.env.company
        archived = self.env['project.task'].create([
            {
                'name': f'Batch archive {index}',
                'project_id': self.project.id,
                'company_id': company.id,
                'user_ids': [(4, self.manager.id)],
                'active': False,
            }
            for index in range(12)
        ])
        Task = self.env['project.task'].with_user(self.manager).with_context(active_test=False)
        domain = [
            ('active', '=', False),
            ('company_id', '=', company.id),
            ('project_id.company_id', '=', company.id),
            ('project_id.active', '=', True),
            ('project_id', '=', self.project.id),
            ('id', 'in', archived.ids),
        ]
        self.env.flush_all()
        prefetch_sizes = []
        orig_can_archive = type(Task)._webvue_can_archive

        def wrapped_can_archive(task):
            prefetch_sizes.append(len(tuple(task._prefetch_ids)))
            return orig_can_archive(task)

        with patch.object(type(Task), '_webvue_can_archive', wrapped_can_archive):
            eligible_ids = eligible_archived_task_ids(Task, domain, batch_size=5)
        legacy = Task.search(domain, order='write_date desc, id desc').filtered(
            lambda task: task._webvue_can_archive(),
        ).ids
        self.assertEqual(list(eligible_ids), list(legacy))
        self.assertEqual(len(eligible_ids), 12)
        self.assertEqual(len(prefetch_sizes), 12)
        self.assertTrue(prefetch_sizes)
        self.assertLessEqual(max(prefetch_sizes), 5)
        self.assertGreater(max(prefetch_sizes), 1)
        # Proven bound: eligibility walks isolated batches; prefetch never
        # holds the whole 12-row candidate set. Unmeasured: SQL count from
        # `_webvue_can_archive` / capability checks (cache may skip fetches).
