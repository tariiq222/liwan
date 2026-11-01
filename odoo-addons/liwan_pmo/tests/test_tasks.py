# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, time, timedelta

import pytz

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase

TASK_KEYS = {'id', 'name', 'description_excerpt', 'project', 'state', 'priority', 'date_deadline',
             'days_remaining', 'is_overdue', 'is_closed', 'personal_stage', 'stage',
             'assignees', 'tags', 'can_write', 'can_approve', 'allowed_transitions',
             'subtask_count', 'subtask_done_count', 'attachment_count'}


@tagged('post_install', '-at_install', 'liwan')
class TestTaskRead(LiwanPmoCase):

    def test_list_requires_mine_filter(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_filter_all_lists_readable_tasks_of_others(self):
        task = self.env['project.task'].create({'name': 'Assigned elsewhere', 'project_id': self.project.id, 'user_ids': [(6, 0, self.manager.ids)]})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertNotIn(task.id, [row['id'] for row in self.api('GET', '/api/v1/tasks?filter=mine&limit=200').json()['items']])
        self.assertIn(task.id, [row['id'] for row in self.api('GET', '/api/v1/tasks?filter=all&limit=200').json()['items']])

    def test_filter_all_keeps_record_rules(self):
        hidden = self.env['project.project'].create({'name': 'Private elsewhere', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({'name': 'Hidden task', 'project_id': hidden.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertNotIn(task.id, [row['id'] for row in self.api('GET', '/api/v1/tasks?filter=all&limit=200').json()['items']])

    def test_unknown_filter_is_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=everyone').json()['code'], 'unsupported_filter')

    def test_list_bad_pagination_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine&limit=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'limit')

    def test_list_negative_limit_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine&limit=-1')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'limit')

    def test_list_non_numeric_offset_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine&offset=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'offset')

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
        self.assertEqual(body['deliverables'], [])
        self.assertIn('description_html', body)
        self.assertEqual(set(body), TASK_KEYS | {'description_html', 'allocated_hours', 'age_days',
                                                   'cycle_days', 'subtasks', 'depends_on', 'attachments',
                                                   'can_manage_dependencies', 'created_at', 'updated_at', 'milestone', 'allowed_actions',
                                                   'planned_start', 'deliverables',
                                                   'completion_pending', 'completion_revision', 'completion_return_note',
                                                   'completion_policy', 'completion_approver', 'completion_blocked_reason'})

    def test_get_task_in_private_project_is_not_found(self):
        # employees may read tasks in projects they can see; a private project's
        # record rule hides the task inside get_visible_record, so the API answers 404
        # and does not confirm that the task exists.
        private = self.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({'name': 'Secret', 'project_id': private.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')


@tagged('post_install', '-at_install', 'liwan')
class TestTaskWrite(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.read_only = new_test_user(
            cls.env, login='api_task_content_read_only', password='api_task_content_read_only_pass',
            name='Task content read only', groups='base.group_user',
        )
        read_only_role = cls.env['liwan.access.role'].create({
            'name_ar': 'قارئ محتوى المهام',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read']),
            ]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.read_only.id, 'role_id': read_only_role.id,
            'company_id': cls.env.company.id,
        })

    def test_create(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'New one', 'project_id': self.project.id})
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body['name'], 'New one')
        self.assertEqual(body['assignees'], [{'id': self.employee.id, 'name': 'Sara'}])
        self.assertEqual(body['state'], 'in_progress')

    def test_create_and_patch_content_preserve_task_metrics(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        payload = {
            'name': 'Content task', 'project_id': self.project.id,
            'description': '<p>Plain task context</p><script>alert(1)</script>',
            'deliverables': [
                {'name': '  First output  ', 'done': False},
                {'name': 'Second output', 'done': True},
            ],
        }
        res = self.api('POST', '/api/v1/tasks', payload)
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        task = self.env['project.task'].browse(body['id'])
        self.assertEqual(body['deliverables'], [
            {'name': 'First output', 'done': False},
            {'name': 'Second output', 'done': True},
        ])
        self.assertIn('Plain task context', body['description_html'])
        self.assertNotIn('<script', body['description_html'].lower())
        self.assertEqual((body['state'], body['is_closed']), ('in_progress', False))
        self.assertEqual(task.liwan_deliverables, body['deliverables'])

        res = self.api('PATCH', f"/api/v1/tasks/{task.id}", {
            'description': '<p>Updated context</p>',
            'deliverables': [{'name': 'Final output', 'done': True}],
        })
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['deliverables'], [{'name': 'Final output', 'done': True}])
        self.assertIn('Updated context', body['description_html'])
        self.assertEqual((body['state'], body['is_closed']), ('in_progress', False))

    def test_content_validation_and_forbidden_fields_do_not_mutate(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        before = self.env['project.task'].search_count([('project_id', '=', self.project.id)])
        for value in (
            None,
            {'name': 'not a list'},
            [{'name': ' ', 'done': False}],
            [{'name': 'Output', 'done': 1}],
            [{'name': 'Output', 'done': False, 'score': 1}],
        ):
            with self.subTest(value=value):
                res = self.api('POST', '/api/v1/tasks', {
                    'name': 'Invalid content', 'project_id': self.project.id,
                    'deliverables': value,
                })
                self.assertEqual(res.status_code, 422, res.text)
                self.assertEqual(res.json()['field'], 'deliverables')
        for value in (None, [], {}, True):
            with self.subTest(description=value):
                res = self.api('POST', '/api/v1/tasks', {
                    'name': 'Invalid description', 'project_id': self.project.id,
                    'description': value,
                })
                self.assertEqual(res.status_code, 422, res.text)
                self.assertEqual(res.json()['field'], 'description')
        self.assertEqual(
            self.env['project.task'].search_count([('project_id', '=', self.project.id)]), before,
        )

        original = self.task_overdue.liwan_deliverables
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {
            'deliverables': [{'name': 'Output', 'done': False, 'score': 1}],
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['field'], 'deliverables')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {
            'liwan_deliverables': [{'name': 'Internal field', 'done': False}],
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'unknown_field')
        self.assertEqual(self.task_overdue.liwan_deliverables, original)

        original_other = self.task_other.liwan_deliverables
        self.authenticate(self.read_only.login, 'api_task_content_read_only_pass')
        detail = self.api('GET', f'/api/v1/tasks/{self.task_other.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertFalse(detail.json()['can_write'])
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_other.id}', {
            'deliverables': [{'name': 'Unauthorized output', 'done': False}],
        })
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'forbidden')
        self.assertEqual(self.task_other.liwan_deliverables, original_other)

    def test_create_with_milestone_and_schedule_keeps_schedule_manager_only(self):
        project = self.env['project.project'].create({
            'name': 'Scheduled task project', 'company_id': self.env.company.id,
            'user_id': self.manager.id, 'date_start': date(2026, 10, 1), 'date': date(2026, 10, 31),
        })
        milestone = self.env['project.milestone'].create({
            'name': 'Scheduled milestone', 'project_id': project.id,
            'liwan_start_date': date(2026, 10, 5), 'deadline': date(2026, 10, 20),
        })
        payload = {
            'name': 'Scheduled task', 'project_id': project.id, 'milestone_id': milestone.id,
            'planned_start': '2026-10-05', 'date_deadline': '2026-10-20T00:00:00Z',
        }
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', payload)
        self.assertEqual(res.status_code, 403, res.text)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/tasks', payload)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['planned_start'], '2026-10-05')
        self.assertEqual(res.json()['milestone']['id'], milestone.id)

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

    def test_create_rejects_invalid_id_shapes_without_writing(self):
        """project_id/parent_id must be parsed before lookup so True/1.0 cannot alias id 1."""
        self.authenticate('api_emp', 'api_emp_pass_123')
        invalid = (True, False, 1.0, 1.5, 0, -3, [], {}, '1.5', 'abc', '0', ' 1', '')
        for value in invalid:
            with self.subTest(field='project_id', value=value):
                res = self.api('POST', '/api/v1/tasks', {'name': 'Shape alias', 'project_id': value})
                self.assertEqual(res.status_code, 422, res.text)
                body = res.json()
                self.assertEqual(body['code'], 'invalid')
                self.assertEqual(body['field'], 'project_id')
            with self.subTest(field='parent_id', value=value):
                res = self.api('POST', '/api/v1/tasks', {
                    'name': 'Shape alias',
                    'project_id': self.project.id,
                    'parent_id': value,
                })
                self.assertEqual(res.status_code, 422, res.text)
                body = res.json()
                self.assertEqual(body['code'], 'invalid')
                self.assertEqual(body['field'], 'parent_id')
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Shape alias')]))
        self.assertFalse(self.env['project.task'].search([
            ('project_id', '=', 1), ('name', '=', 'Shape alias'),
        ]))

    def test_create_accepts_digit_string_ids(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {
            'name': 'String ids',
            'project_id': str(self.project.id),
            'parent_id': str(self.task_overdue.id),
        })
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['project']['id'], self.project.id)
        parent = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertIn('String ids', [t['name'] for t in parent['subtasks']])

    def test_create_null_parent_id_is_optional(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {
            'name': 'Null parent', 'project_id': self.project.id, 'parent_id': None,
        })
        self.assertEqual(res.status_code, 201, res.text)
        self.assertFalse(self.env['project.task'].browse(res.json()['id']).parent_id)

    def test_create_unknown_foreign_ids_do_not_write(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/tasks', {'name': 'Ghost', 'project_id': 999999})
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Ghost')]))

        res = self.api('POST', '/api/v1/tasks', {
            'name': 'Ghost child', 'project_id': self.project.id, 'parent_id': 999999,
        })
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Ghost child')]))

        private = self.env['project.project'].create({
            'name': 'Private create', 'privacy_visibility': 'followers',
        })
        secret = self.env['project.task'].create({
            'name': 'Secret parent', 'project_id': private.id,
        })
        res = self.api('POST', '/api/v1/tasks', {'name': 'Into private', 'project_id': private.id})
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Into private')]))

        res = self.api('POST', '/api/v1/tasks', {
            'name': 'Child of secret', 'project_id': self.project.id, 'parent_id': secret.id,
        })
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Child of secret')]))

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
        # Date.prototype.toISOString() always emits milliseconds — accepted,
        # and normalised away in the stored (second-precision) value.
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'date_deadline': '2030-02-20T09:30:00.000Z'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['date_deadline'], '2030-02-20T09:30:00Z')

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

    def test_patch_malformed_values_are_422_not_500(self):
        """Every coercion in parse_task_vals must raise ApiError, not escape as a 500.

        api_handler only maps ApiError/MissingError/AccessError/ValidationError/
        UserError — a bare ValueError or AttributeError from int()/float()/
        str.replace() propagated out as an HTTP 500 with no contract body.
        """
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        tid = self.task_other.id
        for payload, field in (
            ({'personal_stage_type_id': 'abc'}, 'personal_stage_type_id'),
            ({'allocated_hours': 'x'}, 'allocated_hours'),
            ({'date_deadline': 123}, 'date_deadline'),
            # offset-bearing ISO: deadlines are UTC instants, so this is rejected
            # rather than silently truncated to the wrong instant.
            ({'date_deadline': '2030-01-15T09:00:00+03:00'}, 'date_deadline'),
        ):
            with self.subTest(payload=payload):
                res = self.api('PATCH', f'/api/v1/tasks/{tid}', payload)
                self.assertEqual(res.status_code, 422, res.text)
                body = res.json()
                self.assertEqual(body['code'], 'invalid')
                self.assertEqual(body['field'], field)

    def test_patch_rejects_another_users_personal_stage(self):
        """personal_stage_type_id's domain is UI-only — the API must own the check."""
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        manager_stages = self.api('GET', '/api/v1/me/personal-stages').json()
        self.authenticate('api_emp', 'api_emp_pass_123')
        own_stages = self.api('GET', '/api/v1/me/personal-stages').json()
        foreign = manager_stages[0]['id']
        self.assertNotIn(foreign, [s['id'] for s in own_stages])
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'personal_stage_type_id': foreign})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'personal_stage_type_id')
        # ...and a stage id that does not exist at all is rejected the same way.
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'personal_stage_type_id': 999999})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'personal_stage_type_id')

    def test_patch_tag_ids_unknown_id_is_422_not_500(self):
        """tag_ids ids were shape-checked but never resolved against project.tags,
        so an unknown id used to reach the ORM write and raise a FK IntegrityError
        (500) instead of the contracted 422."""
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_other.id}', {'tag_ids': [999999]})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'tag_ids')

    def test_list_unknown_state_filter_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?filter=mine&state=in_progress,bogus')
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'state')


@tagged('post_install', '-at_install', 'liwan')
class TestTaskListSort(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Task = cls.env['project.task']
        cls.sooner = Task.create({'name': 'Sooner', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
                                  'date_deadline': '2030-01-01 08:00:00', 'priority': '0'})
        cls.later = Task.create({'name': 'Later', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
                                 'date_deadline': '2030-06-01 08:00:00', 'priority': '1'})
        cls.undated = Task.create({'name': 'Undated', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
                                   'priority': '1'})
        cls.undated_too = Task.create({'name': 'Undated too', 'project_id': cls.project.id,
                                       'user_ids': [(4, cls.employee.id)], 'priority': '0'})
        # Open tasks of the employee, in record-number order.
        cls.by_id = [cls.task_overdue.id, cls.sooner.id, cls.later.id, cls.undated.id, cls.undated_too.id]

    def ids(self, query=''):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks?filter=mine{query}')
        self.assertEqual(res.status_code, 200)
        return [t['id'] for t in res.json()['items']]

    def test_default_is_record_number_ascending(self):
        self.assertEqual(self.ids(), self.by_id)

    def test_record_number_both_directions(self):
        self.assertEqual(self.ids('&sort=id asc'), self.by_id)
        self.assertEqual(self.ids('&sort=id desc'), self.by_id[::-1])

    def test_deadline_puts_undated_tasks_last_in_both_directions(self):
        overdue, sooner, later = self.task_overdue.id, self.sooner.id, self.later.id
        self.assertEqual(self.ids('&sort=date_deadline asc'), [overdue, sooner, later, self.undated.id, self.undated_too.id])
        self.assertEqual(self.ids('&sort=date_deadline desc'), [later, sooner, overdue, self.undated.id, self.undated_too.id])

    def test_priority_both_directions_with_stable_ties(self):
        urgent = [self.task_overdue.id, self.later.id, self.undated.id]
        normal = [self.sooner.id, self.undated_too.id]
        self.assertEqual(self.ids('&sort=priority desc'), urgent + normal)
        self.assertEqual(self.ids('&sort=priority asc'), normal + urgent)

    def test_unknown_sort_keys_and_directions_are_refused(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for query in ('zzz', 'nonsense desc', 'state desc', 'id;drop table', 'id sideways'):
            res = self.api('GET', f'/api/v1/tasks?filter=mine&sort={query}')
            self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'sort'), query)

    def test_sort_is_applied_before_paging(self):
        self.assertEqual(self.ids('&sort=id desc&limit=2&offset=1'), self.by_id[::-1][1:3])


@tagged('post_install', '-at_install', 'liwan')
class TestTaskFilters(LiwanPmoCase):
    """`assignee`, `deadline` and `priority`, on the list and on the summary through one shared domain."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # UTC+3: the caller's midnight is 21:00 UTC of the day before, so a UTC-day reading would be wrong.
        cls.employee.tz = 'Asia/Riyadh'
        cls.tz = pytz.timezone('Asia/Riyadh')
        cls.fp = cls.env['project.project'].create({'name': 'Filter project', 'company_id': cls.env.company.id})
        cls.today = fields.Date.context_today(cls.env['project.task'].with_user(cls.employee))
        cls.day_start = cls.local_start(cls.today)
        Task = cls.env['project.task']

        def make(name, deadline, users=(), priority='0', **vals):
            return Task.create({'name': name, 'project_id': cls.fp.id, 'date_deadline': deadline, 'priority': priority,
                                'user_ids': [(6, 0, [u.id for u in users])], **vals})

        cls.just_overdue = make('just overdue', cls.day_start - timedelta(seconds=1), [cls.employee], '3')
        cls.today_first = make('today first second', cls.day_start, [cls.employee], '2')
        cls.today_last = make('today last second', cls.local_start(cls.today + timedelta(days=1)) - timedelta(seconds=1),
                              [cls.manager], '1')
        cls.next_week = make('in eight days', cls.local_start(cls.today + timedelta(days=8)), [cls.employee, cls.manager])
        cls.undated = make('undated', False, [], '3')
        cls.done_overdue = make('done and late', cls.day_start - timedelta(days=2), [cls.employee], '0', state='1_done')

    @classmethod
    def local_start(cls, day):
        return cls.tz.localize(datetime.combine(day, time.min)).astimezone(pytz.utc).replace(tzinfo=None)

    def ids(self, query, closed=False):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks?project_id={self.fp.id}&closed={int(closed)}{query}')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['total'], len(body['items']))
        return {t['id'] for t in body['items']}

    def summary(self, query):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/summary?project_id={self.fp.id}{query}')
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def assert_agrees(self, query, expected_open, expected_done=()):
        """The list and the summary count the same tasks for one query."""
        self.assertEqual(self.ids(query), set(expected_open))
        self.assertEqual(self.ids(query, closed=True), set(expected_done))
        summary = self.summary(query)
        self.assertEqual((summary['open'], summary['done'], summary['total']),
                         (len(expected_open), len(expected_done), len(expected_open) + len(expected_done)))

    def test_assignee_me_none_and_user_id(self):
        self.assert_agrees('&assignee=me', {self.just_overdue.id, self.today_first.id, self.next_week.id}, {self.done_overdue.id})
        self.assert_agrees('&assignee=none', {self.undated.id})
        self.assert_agrees(f'&assignee={self.manager.id}', {self.today_last.id, self.next_week.id})

    def test_assignee_alone_is_a_scope(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?assignee=none')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn(self.undated.id, {t['id'] for t in res.json()['items']})
        self.assertEqual(self.api('GET', '/api/v1/tasks?deadline=today').status_code, 400)

    def test_deadline_today_uses_the_callers_day(self):
        self.assert_agrees('&deadline=today', {self.today_first.id, self.today_last.id})

    def test_deadline_overdue_is_open_tasks_before_the_callers_day(self):
        # The boundary second of the previous local day is overdue; the first second of today is not.
        self.assert_agrees('&deadline=overdue', {self.just_overdue.id})
        # Overdue only ever matches open tasks, so the done scope stays empty although its task is late.
        self.assertEqual(self.ids('&deadline=overdue', closed=True), set())

    def test_deadline_none_is_tasks_without_a_deadline(self):
        self.assert_agrees('&deadline=none', {self.undated.id})

    def test_deadline_week_ends_at_the_next_language_week_start(self):
        lang = self.env['res.lang']._lang_get(self.employee.lang or 'en_US')
        for week_start in (1, 7, 4):
            lang.week_start = str(week_start)
            end = self.today + timedelta(days=1)
            while end.isoweekday() != week_start:
                end += timedelta(days=1)
            inside = self.env['project.task'].create({
                'name': 'last second of the week', 'project_id': self.fp.id, 'user_ids': [(4, self.employee.id)],
                'date_deadline': self.local_start(end) - timedelta(seconds=1)})
            outside = self.env['project.task'].create({
                'name': 'first second of next week', 'project_id': self.fp.id, 'user_ids': [(4, self.employee.id)],
                'date_deadline': self.local_start(end)})
            week = self.ids('&deadline=week')
            self.assertLessEqual({self.today_first.id, self.today_last.id, inside.id}, week, week_start)
            self.assertFalse({self.just_overdue.id, self.next_week.id, outside.id, self.undated.id} & week, week_start)
            self.assertEqual(self.summary('&deadline=week')['open'], len(week))
            (inside + outside).unlink()

    def test_priority_single_and_list(self):
        self.assert_agrees('&priority=3', {self.just_overdue.id, self.undated.id})
        self.assert_agrees('&priority=0', {self.next_week.id}, {self.done_overdue.id})
        self.assert_agrees('&priority=3,2', {self.just_overdue.id, self.undated.id, self.today_first.id})
        self.assert_agrees('&priority=1,1', {self.today_last.id})

    def test_filters_combine_with_each_other_and_with_state_and_project(self):
        self.assert_agrees('&assignee=me&priority=3,2&deadline=today', {self.today_first.id})
        self.assert_agrees('&assignee=me&deadline=overdue&state=in_progress', {self.just_overdue.id})
        self.assert_agrees('&assignee=me&deadline=overdue&state=done', set())
        self.assert_agrees(f'&assignee={self.manager.id}&priority=1&q=today', {self.today_last.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        mine = self.api('GET', f'/api/v1/tasks?filter=mine&assignee=none&project_id={self.fp.id}').json()
        self.assertEqual(mine, {'items': [], 'total': 0})
        other = self.api('GET', f'/api/v1/tasks?assignee=me&deadline=today&project_id={self.project.id}').json()
        self.assertEqual(other, {'items': [], 'total': 0})

    def test_summary_overdue_follows_the_filters(self):
        self.assertEqual(self.summary('&priority=3'), {'total': 2, 'open': 2, 'overdue': 1, 'done': 0})
        self.assertEqual(self.summary('&assignee=me'), {'total': 4, 'open': 3, 'overdue': 1, 'done': 1})
        self.assertEqual(self.summary('&deadline=today'), {'total': 2, 'open': 2, 'overdue': 0, 'done': 0})

    def test_invalid_values_are_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for base in ('/api/v1/tasks?filter=mine', '/api/v1/tasks/summary?filter=mine'):
            for query, field in (
                ('assignee=somebody', 'assignee'), ('assignee=0', 'assignee'), ('assignee=-3', 'assignee'),
                ('assignee=1.5', 'assignee'), ('assignee=999999999', 'assignee'), ('assignee=', 'assignee'),
                ('deadline=tomorrow', 'deadline'), ('deadline=', 'deadline'),
                ('priority=4', 'priority'), ('priority=high', 'priority'), ('priority=1,x', 'priority'), ('priority=', 'priority'),
            ):
                res = self.api('GET', f'{base}&{query}')
                self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', field), (base, query))

    def test_invalid_values_win_over_an_unreadable_project(self):
        self.fp.write({'privacy_visibility': 'followers'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/tasks?project_id={self.fp.id}&deadline=never').status_code, 422)
        self.assertEqual(self.api('GET', f'/api/v1/tasks?project_id={self.fp.id}&deadline=today').json(),
                         {'items': [], 'total': 0})

    def test_other_companies_stay_out_of_every_filter(self):
        company_b = self.env['res.company'].create({'name': 'Filter company B'})
        foreign_project = self.env['project.project'].create({'name': 'Foreign', 'company_id': company_b.id})
        foreign = self.env['project.task'].create({
            'name': 'Foreign task', 'project_id': foreign_project.id, 'company_id': company_b.id,
            'user_ids': [(4, self.employee.id)], 'priority': '3', 'date_deadline': self.day_start})
        self.authenticate('api_emp', 'api_emp_pass_123')
        for query in ('assignee=me', 'filter=mine&deadline=today', 'filter=mine&priority=3', 'assignee=none'):
            body = self.api('GET', f'/api/v1/tasks?{query}&closed=0').json()
            self.assertNotIn(foreign.id, {t['id'] for t in body['items']}, query)
        summary = self.api('GET', f'/api/v1/tasks/summary?project_id={foreign_project.id}&assignee=me').json()
        self.assertEqual(summary['total'], 0)


@tagged('post_install', '-at_install', 'liwan')
class TestTaskProjectScope(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Stage = cls.env['project.task.type']
        cls.stage_todo = Stage.create({'name': 'To Do', 'sequence': 1, 'project_ids': [(4, cls.project.id)]})
        cls.stage_doing = Stage.create({'name': 'Doing', 'sequence': 2, 'project_ids': [(4, cls.project.id)]})
        cls.other_project = cls.env['project.project'].create({'name': 'Other'})
        cls.stage_elsewhere = Stage.create({'name': 'Elsewhere', 'project_ids': [(4, cls.other_project.id)]})
        # Force the fixture tasks onto the new first stage (they were created before it existed).
        (cls.task_overdue + cls.task_done + cls.task_other).write({'stage_id': cls.stage_todo.id})

    def test_list_project_id_alone_lists_every_readable_task(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?project_id={self.project.id}').json()
        self.assertEqual({t['id'] for t in body['items']}, {self.task_overdue.id, self.task_other.id})
        self.assertEqual(body['items'][0]['stage'], {'id': self.stage_todo.id, 'name': 'To Do'})

    def test_list_mine_and_project_id_is_the_intersection(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?filter=mine&project_id={self.project.id}').json()
        self.assertEqual([t['id'] for t in body['items']], [self.task_overdue.id])
        body = self.api('GET', f'/api/v1/tasks?filter=mine&project_id={self.other_project.id}').json()
        self.assertEqual(body['items'], [])

    def test_list_project_id_must_be_an_int(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?project_id=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'project_id')

    def test_list_unknown_filter_is_400(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks?filter=theirs&project_id={self.project.id}')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['code'], 'unsupported_filter')

    def test_list_unreadable_project_is_empty_not_404(self):
        self.project.write({'privacy_visibility': 'followers'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks?project_id={self.project.id}').json()
        self.assertEqual(body, {'items': [], 'total': 0})

    def test_list_unknown_project_id_is_empty_not_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tasks?project_id=999999').json()
        self.assertEqual(body, {'items': [], 'total': 0})

    def test_list_project_id_zero_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/tasks?project_id=0')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'project_id')
        # ...and it must not silently drop the project scope when paired with filter=mine.
        res = self.api('GET', '/api/v1/tasks?filter=mine&project_id=0')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'project_id')

    def test_list_unreadable_project_id_with_bad_limit_is_422_not_200(self):
        # limit/offset must be validated even when project_id short-circuits to an empty list.
        self.project.write({'privacy_visibility': 'followers'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks?project_id={self.project.id}&limit=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'limit')

    def test_assignee_of_task_in_followers_project_sees_it(self):
        """An assignee doesn't need to follow their own private project to read its name."""
        private = self.env['project.project'].create({'name': 'Private HQ', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({
            'name': 'Confidential', 'project_id': private.id, 'user_ids': [(4, self.employee.id)],
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/tasks?filter=mine').json()
        item = next(t for t in body['items'] if t['id'] == task.id)
        self.assertEqual(item['project'], {'id': private.id, 'name': 'Private HQ'})
        res = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['project'], {'id': private.id, 'name': 'Private HQ'})

    def test_detail_includes_stage(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertEqual(body['stage'], {'id': self.stage_todo.id, 'name': 'To Do'})

    def test_patch_stage_id_moves_the_task(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': self.stage_doing.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['stage'], {'id': self.stage_doing.id, 'name': 'Doing'})
        self.assertEqual(self.task_overdue.stage_id, self.stage_doing)

    def test_patch_stage_of_another_project_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': self.stage_elsewhere.id})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'stage_id')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': None})
        self.assertEqual(res.status_code, 422)
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'stage_id': 'x'})
        self.assertEqual(res.status_code, 422)

    def test_patch_stage_id_of_another_users_personal_stage_is_422_not_403(self):
        """A *personal* stage id (user_id set, no project_ids) isn't one of the project's
        stages, but `task_type_visibility_rule` denies read on someone else's personal
        stage — so this must not leak that ir.rule AccessError as a 403."""
        foreign_personal_stage = self.env['project.task.type'].sudo().create({
            'name': 'Mine', 'user_id': self.manager.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}',
                       {'stage_id': foreign_personal_stage.id})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'stage_id')


@tagged('post_install', '-at_install', 'liwan')
class TestTaskArchiveAndMilestone(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.milestone = cls.env['project.milestone'].create({'name': 'M', 'project_id': cls.project.id})
        cls.other_project = cls.env['project.project'].create({'name': 'Other'})
        cls.foreign_milestone = cls.env['project.milestone'].create({'name': 'F', 'project_id': cls.other_project.id})
        cls.mine = cls.env['project.task'].with_user(cls.employee).create({'name': 'Mine', 'project_id': cls.project.id})

    def test_patch_milestone(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': self.milestone.id})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['milestone'], {'id': self.milestone.id, 'name': 'M'})
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': self.foreign_milestone.id})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'milestone_id'))
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': None})
        self.assertIsNone(res.json()['milestone'])

    def test_patch_milestone_of_unreadable_project_is_422_not_403(self):
        """A milestone belonging to a private project the employee can't read must not
        leak `milestone_visibility_rule`'s AccessError as a 403 - the contract for an
        invalid milestone_id is 422, not 403 (existence oracle aside)."""
        private = self.env['project.project'].create({'name': 'Private', 'privacy_visibility': 'followers'})
        private_milestone = self.env['project.milestone'].create({'name': 'Confidential M', 'project_id': private.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('PATCH', f'/api/v1/tasks/{self.task_overdue.id}', {'milestone_id': private_milestone.id})
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['field'], 'milestone_id')

    def test_detail_milestone_name_of_task_in_followers_project(self):
        """An assignee of a task in a followers-only project they don't follow must still
        see the milestone's name (resolved in sudo, mirroring _project_ref)."""
        private = self.env['project.project'].create({'name': 'Private HQ', 'privacy_visibility': 'followers'})
        private_milestone = self.env['project.milestone'].create({'name': 'Launch', 'project_id': private.id})
        task = self.env['project.task'].create({
            'name': 'Confidential', 'project_id': private.id, 'user_ids': [(4, self.employee.id)],
            'milestone_id': private_milestone.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['milestone']['name'], private_milestone.name)

    def test_archive_rules(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        # creator may archive their own task
        res = self.api('POST', f'/api/v1/tasks/{self.mine.id}/archive')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(self.mine.active)
        self.assertEqual(self.api('GET', '/api/v1/tasks?filter=mine').json()['total'], 1)
        # not creator, not manager → 403
        res = self.api('POST', f'/api/v1/tasks/{self.task_other.id}/archive')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_other.id}/archive').status_code, 200)
