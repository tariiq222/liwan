# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestTaskLifecycle(NasqPmoCase):

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
        read_only_role = cls.env['nasq.access.role'].create({
            'name_ar': 'قارئ دورة المهام',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.read_only.id, 'role_id': read_only_role.id,
            'company_id': cls.env.company.id,
        })

    def test_dependency_marker_does_not_trust_mixed_task_writes(self):
        marker = self.env.cr.precommit.data
        marker['nasq_pmo.dependency_write_depth'] = 1
        try:
            with self.assertRaises(AccessError):
                self.task_overdue.with_user(self.manager).write({
                    'depend_on_ids': [(6, 0, [])], 'name': 'must remain protected',
                })
        finally:
            marker.pop('nasq_pmo.dependency_write_depth', None)

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
            'id', 'name', 'project', 'state', 'priority', 'date_deadline', 'days_remaining',
            'is_overdue', 'is_closed', 'personal_stage', 'stage', 'assignees', 'tags',
            'can_write', 'can_approve',
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
