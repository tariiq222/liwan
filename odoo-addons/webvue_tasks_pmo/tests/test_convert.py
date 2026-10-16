# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.webvue_tasks.tests.common import WebVueTasksCase
from odoo.addons.webvue_tasks_pmo.models.project_task_personal import (
    CONVERT_MARKER,
    CONVERT_WRITE_FIELDS,
)

CONVERT_URL = '/api/v1/my-tasks/%s/convert'
TARGETS_URL = '/api/v1/my-tasks/convert-targets'
ROLE_KEYS = [
    'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.write',
]


@tagged('post_install', '-at_install', 'webvue', 'webvue_tasks')
class TestMyTaskConvert(WebVueTasksCase):
    """POST /api/v1/my-tasks/<id>/convert and GET /api/v1/my-tasks/convert-targets."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = cls.env['project.project'].create({
            'name': 'Convert target', 'company_id': cls.env.company.id,
        })
        cls.limited = cls._limited_user('tasks_limited')

    @classmethod
    def _limited_user(cls, login):
        """Reads and writes tasks and projects, but holds no ``pmo.tasks.create``."""
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', groups='base.group_user')
        permissions = cls.env['webvue.access.permission'].search([('key', 'in', ROLE_KEYS)])
        role = cls.env['webvue.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)],
        })
        cls.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id,
        })
        return user

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _service(self, user):
        return self.env['webvue.my.task.service'].with_user(user)

    def _convert(self, task, project=None, **extra):
        body = {'project_id': (project or self.project).id, **extra}
        return self.api('POST', CONVERT_URL % task.id, json=body)

    def _error(self, response, status, code, field=None):
        self.assertEqual(response.status_code, status, response.text)
        body = response.json()
        self.assertEqual(body['code'], code)
        if field:
            self.assertEqual(body.get('field'), field)

    def _target_names(self, q=''):
        response = self.api('GET', f'{TARGETS_URL}?q={q}')
        self.assertEqual(response.status_code, 200, response.text)
        return [item['name'] for item in response.json()['items']]

    # convert

    def test_convert_moves_subtasks_and_attachments(self):
        service = self._service(self.alice)
        parent = service._create_task({
            'name': 'Parent', 'description': 'Details', 'date_deadline': '2026-12-01T09:00:00Z',
            'priority': 'high', 'assignees': [self.alice.id, self.bob.id],
        })
        open_child = service._create_task({'name': 'Open child', 'parent_id': parent.id})
        done_child = service._create_task({'name': 'Done child', 'parent_id': parent.id})
        service._transition(done_child, 'done')
        attachments = self.env['ir.attachment'].create([{
            'name': f'a{index}.txt', 'res_model': 'project.task', 'res_id': record.id,
            'datas': base64.b64encode(b'hello'), 'mimetype': 'text/plain',
        } for index, record in enumerate((parent, open_child))])
        deadline = parent.date_deadline
        self._login(self.alice)
        response = self._convert(parent)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'href': f'/projects/{self.project.id}/tasks/{parent.id}'})
        parent.invalidate_recordset()
        self.assertEqual(parent.project_id, self.project)
        self.assertFalse(parent.webvue_personal)
        self.assertEqual(parent.state, '01_in_progress')
        self.assertEqual(parent.user_ids, self.alice | self.bob)
        self.assertEqual(parent.date_deadline, deadline)
        self.assertEqual(parent.priority, '1')
        self.assertIn('Details', parent.description)
        for child, state in ((open_child, '01_in_progress'), (done_child, '1_done')):
            child.invalidate_recordset()
            self.assertEqual(child.project_id, self.project)
            self.assertFalse(child.webvue_parent_id)
            self.assertEqual(child.parent_id, parent)
            self.assertFalse(child.webvue_personal)
            self.assertEqual(child.state, state)
        attachments.invalidate_recordset()
        self.assertEqual(attachments[0].res_id, parent.id)
        self.assertEqual(attachments[1].res_id, open_child.id)
        self.assertEqual(
            self.env['ir.attachment'].with_user(self.alice).search([
                ('res_model', '=', 'project.task'), ('res_id', '=', parent.id)]),
            attachments[0])

    def test_convert_requires_pmo_tasks_create_on_target_403(self):
        task = self._service(self.limited)._create_task({'name': 'No create right'})
        self._login(self.limited)
        self._error(self._convert(task), 403, 'forbidden')
        task.invalidate_recordset()
        self.assertTrue(task.webvue_personal)

    def test_convert_requires_tasks_write_403(self):
        task = self.make_personal_task(self.alice, 'read only caller', assignees=[self.alice.id, self.bob.id])
        reader = new_test_user(self.env, login='tasks_conv_reader', password='tasks_conv_reader_pass_123',
                               groups='base.group_user')
        permissions = self.env['webvue.access.permission'].search([('key', 'in', [
            'tasks.tasks.read', 'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create'])])
        role = self.env['webvue.access.role'].create({
            'name_ar': 'reader', 'permission_ids': [Command.set(permissions.ids)]})
        self.env['webvue.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id})
        task.user_ids = [Command.link(reader.id)]
        self._login(reader)
        self._error(self._convert(task), 403, 'forbidden')

    def test_convert_stranger_and_unknown_task_404(self):
        task = self.make_personal_task(self.alice, 'private')
        self._login(self.carol)
        self._error(self._convert(task), 404, 'not_found')
        self._error(self.api('POST', CONVERT_URL % 987654321, json={'project_id': self.project.id}),
                    404, 'not_found')

    def test_after_convert_my_tasks_detail_404_and_pmo_detail_200(self):
        task = self.make_personal_task(self.alice, 'moves')
        self._login(self.alice)
        service = self._service(self.alice)
        self.assertEqual(service._get_personal(task.id), task)
        self.assertEqual(self._convert(task).status_code, 200)
        task.invalidate_recordset()
        # The personal service no longer finds it (this is what GET /api/v1/my-tasks/<id> answers).
        with self.assertRaises(ApiError) as caught:
            service._get_personal(task.id)
        self.assertEqual((caught.exception.status, caught.exception.code), (404, 'not_found'))
        response = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['id'], task.id)

    def test_convert_twice_422(self):
        task = self.make_personal_task(self.alice, 'once')
        self._login(self.alice)
        self.assertEqual(self._convert(task).status_code, 200)
        self._error(self._convert(task), 422, 'invalid', 'project_id')

    def test_convert_done_task_422(self):
        task = self.make_personal_task(self.alice, 'finished')
        self._service(self.alice)._transition(task, 'done')
        self._login(self.alice)
        self._error(self._convert(task), 422, 'invalid', 'state')
        task.invalidate_recordset()
        self.assertTrue(task.webvue_personal)

    def test_convert_subtask_422(self):
        parent = self.make_personal_task(self.alice, 'parent')
        child = self._service(self.alice)._create_task({'name': 'child', 'parent_id': parent.id})
        self._login(self.alice)
        self._error(self._convert(child), 422, 'invalid', 'parent_id')

    def test_convert_to_a_bad_project_422(self):
        task = self.make_personal_task(self.alice, 'target checks')
        archived = self.env['project.project'].create({
            'name': 'Archived', 'company_id': self.env.company.id, 'active': False})
        foreign = self.env['project.project'].create({
            'name': 'Foreign', 'company_id': self.other_company.id})
        self._login(self.alice)
        for project_id in (archived.id, foreign.id, 987654321):
            with self.subTest(project_id=project_id):
                response = self.api('POST', CONVERT_URL % task.id, json={'project_id': project_id})
                self._error(response, 422, 'invalid', 'project_id')
        for body in ({}, {'project_id': 'x'}, {'project_id': 0}):
            with self.subTest(body=body):
                self._error(self.api('POST', CONVERT_URL % task.id, json=body), 422, 'invalid', 'project_id')
        task.invalidate_recordset()
        self.assertTrue(task.webvue_personal)

    def test_a_plain_project_write_still_cannot_assign_a_project(self):
        # The bridge opens project_id for the checked convert only, never for a direct write.
        task = self.make_personal_task(self.alice, 'guarded')
        with self.assertRaises(AccessError):
            task.with_user(self.alice).write({'project_id': self.project.id})

    def test_write_fields_open_only_for_the_tasks_of_a_running_convert(self):
        Task = self.env['project.task'].with_user(self.alice)
        mine = self.make_personal_task(self.alice, 'mine')
        other = self.make_personal_task(self.alice, 'other')
        self.assertEqual(Task.browse(mine.id)._webvue_extra_write_fields(), frozenset())
        marker = self.env.cr.precommit.data
        marker[CONVERT_MARKER] = (self.alice.id, self.env.company.id, frozenset(mine.ids))
        self.addCleanup(marker.pop, CONVERT_MARKER, None)
        self.assertEqual(Task.browse(mine.id)._webvue_extra_write_fields(), CONVERT_WRITE_FIELDS)
        self.assertEqual(Task.browse(other.id)._webvue_extra_write_fields(), frozenset())
        self.assertEqual(Task.browse((mine | other).ids)._webvue_extra_write_fields(), frozenset())
        # Another caller never inherits the marker of the running convert.
        self.assertEqual(
            self.env['project.task'].with_user(self.bob).browse(mine.id)._webvue_extra_write_fields(),
            frozenset())

    def _shared_parent(self, **extra):
        """alice's parent shared with bob, plus a sub-task bob made for himself alone."""
        role = self.env.ref('webvue_core.role_employee')
        for user in (self.alice, self.bob):
            if not self.env['webvue.access.assignment'].search_count([
                    ('user_id', '=', user.id), ('role_id', '=', role.id)]):
                self.env['webvue.access.assignment'].create({
                    'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
        parent = self._service(self.alice)._create_task({
            'name': 'Shared parent', 'assignees': [self.alice.id, self.bob.id], **extra})
        child = self._service(self.bob)._create_task({
            'name': 'Bob child', 'parent_id': parent.id, 'assignees': [self.bob.id]})
        self.assertNotIn(self.alice, child.user_ids)
        return parent, child

    def test_convert_rehomes_a_subtask_of_another_assignee_and_archived_ones(self):
        parent, child = self._shared_parent()
        archived = self._service(self.alice)._create_task({'name': 'Archived child', 'parent_id': parent.id})
        archived.sudo().write({'active': False})
        self._login(self.alice)
        self.assertEqual(self._convert(parent).status_code, 200)
        for record in (child, archived):
            record = record.with_context(active_test=False)
            record.invalidate_recordset()
            self.assertEqual(record.project_id, self.project, record.name)
            self.assertEqual(record.parent_id, parent, record.name)
            self.assertFalse(record.webvue_parent_id, record.name)
        self.assertFalse(archived.active)
        # No personal row is left pointing at the converted parent.
        self.assertFalse(self.env['project.task'].with_context(active_test=False).search_count(
            [('webvue_parent_id', '=', parent.id)]))

    def test_convert_refuses_a_subtask_the_caller_cannot_write(self):
        parent, child = self._shared_parent()
        # Take the parent clause out of the write rule: alice still reads bob's sub-task
        # (read rule) but nothing lets her write it any more.
        rule = self.env.ref('webvue_tasks.rule_personal_task_creator_write')
        rule.domain_force = "[('webvue_personal', '=', True), '|', ('create_uid', '=', user.id), ('user_ids', 'in', [user.id])]"
        self.assertTrue(child.with_user(self.alice).has_access('read'))
        self.assertFalse(child.with_user(self.alice).has_access('write'))
        self._login(self.alice)
        self._error(self._convert(parent), 422, 'invalid', 'parent_id')
        parent.invalidate_recordset()
        child.invalidate_recordset()
        self.assertTrue(parent.webvue_personal)
        self.assertEqual(child.webvue_parent_id, parent)

    def test_convert_done_subtask_needs_approval_in_the_target_project(self):
        parent, child = self._shared_parent()
        self._service(self.bob)._transition(child, 'done')
        approving = self.env['project.project'].create({
            'name': 'Approving project', 'company_id': self.env.company.id,
            'user_id': self.alice.id, 'webvue_completion_approval': 'project_manager',
        })
        self._login(self.alice)
        self._error(self._convert(parent, project=approving), 422, 'invalid', 'state')
        parent.invalidate_recordset()
        child.invalidate_recordset()
        self.assertTrue(parent.webvue_personal)
        self.assertEqual(child.webvue_parent_id, parent)
        self.assertEqual(child.state, '1_done')
        # A project without approval takes the done sub-task as it is.
        self.assertEqual(self._convert(parent).status_code, 200)
        child.invalidate_recordset()
        self.assertEqual((child.project_id, child.state), (self.project, '1_done'))

    def test_convert_rejects_ids_beyond_the_integer_range(self):
        task = self.make_personal_task(self.alice, 'ids')
        self._login(self.alice)
        self._error(self.api('POST', CONVERT_URL % 2 ** 31, json={'project_id': self.project.id}), 404, 'not_found')
        self._error(self.api('POST', CONVERT_URL % 10 ** 30, json={'project_id': self.project.id}), 404, 'not_found')
        for project_id in (2 ** 31, 10 ** 30):
            self._error(self.api('POST', CONVERT_URL % task.id, json={'project_id': project_id}),
                        422, 'invalid', 'project_id')

    def test_pmo_tasks_write_is_needed_to_convert(self):
        user = new_test_user(self.env, login='tasks_nowrite', password='tasks_nowrite_pass_123',
                             groups='base.group_user')
        keys = [key for key in ROLE_KEYS if key != 'pmo.tasks.write'] + ['pmo.tasks.create']
        permissions = self.env['webvue.access.permission'].search([('key', 'in', keys)])
        role = self.env['webvue.access.role'].create({
            'name_ar': 'nowrite', 'permission_ids': [Command.set(permissions.ids)]})
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
        task = self.make_personal_task(user, 'cannot move')
        self.assertFalse(self._service(user)._allowed_actions(task)['convert'])
        self._login(user)
        self.assertEqual(self.api('GET', TARGETS_URL).json(), {'items': [], 'total': 0})
        self._error(self._convert(task), 403, 'forbidden')

    def test_tasks_feature_gate_closes_both_routes(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        retained = [key for key in (profile.retained_read_features or []) if key != 'tasks.enabled']
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'tasks.enabled': False}, 'retained_read_features': retained})
        task = self.make_personal_task(self.alice, 'gated by tasks')
        self._login(self.alice)
        for response in (self.api('GET', TARGETS_URL), self._convert(task)):
            self._error(response, 403, 'feature_not_included')
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'tasks.enabled'})

    # allowed actions

    def test_allowed_actions_convert_flag_true_only_with_bridge_and_capability(self):
        task = self.make_personal_task(self.alice, 'flag')
        self.assertTrue(self._service(self.alice)._allowed_actions(task)['convert'])
        task = self.make_personal_task(self.limited, 'flag limited')
        self.assertTrue(self._service(self.limited)._allowed_actions(task)['write'])
        self.assertFalse(self._service(self.limited)._allowed_actions(task)['convert'])

    def test_allowed_actions_convert_flag_false_when_pmo_feature_is_off(self):
        task = self.make_personal_task(self.alice, 'flag off')
        profile = self.env.ref('webvue_platform.tenant_profile')
        retained = [key for key in (profile.retained_read_features or []) if key != 'pmo.enabled']
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        self.assertFalse(self._service(self.alice)._allowed_actions(task)['convert'])

    # targets

    def test_convert_targets_only_eligible_projects(self):
        Project = self.env['project.project']
        Project.create({'name': 'Archived target', 'company_id': self.env.company.id, 'active': False})
        Project.create({'name': 'Foreign target', 'company_id': self.other_company.id})
        self._login(self.alice)
        response = self.api('GET', TARGETS_URL)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], len(body['items']))
        names = [item['name'] for item in body['items']]
        self.assertIn('Convert target', names)
        self.assertNotIn('Archived target', names)
        self.assertNotIn('Foreign target', names)
        self.assertEqual(set(body['items'][0]), {'id', 'name'})
        # The limited user cannot create tasks in any project: nothing to offer.
        self._login(self.limited)
        response = self.api('GET', TARGETS_URL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'items': [], 'total': 0})

    def test_convert_targets_search_is_literal_and_capped(self):
        Project = self.env['project.project']
        Project.create([
            {'name': 'Zeta 100%', 'company_id': self.env.company.id},
            {'name': 'Zeta 1000', 'company_id': self.env.company.id},
            {'name': 'Zeta_a', 'company_id': self.env.company.id},
            {'name': 'ZetaXa', 'company_id': self.env.company.id},
        ])
        self._login(self.alice)
        self.assertEqual(self._target_names('100%25'), ['Zeta 100%'])
        self.assertEqual(self._target_names('zeta_a'), ['Zeta_a'])
        Project.create([{'name': f'Bulk {index:02}', 'company_id': self.env.company.id} for index in range(25)])
        self.assertEqual(len(self._target_names()), 20)
        self.assertEqual(self.api('GET', TARGETS_URL).json()['total'], 20)

    def test_convert_targets_requires_pmo_projects_read(self):
        user = new_test_user(self.env, login='tasks_noproj', password='tasks_noproj_pass_123',
                             groups='base.group_user')
        permissions = self.env['webvue.access.permission'].search([('key', 'in', ['tasks.tasks.read'])])
        role = self.env['webvue.access.role'].create({
            'name_ar': 'noproj', 'permission_ids': [Command.set(permissions.ids)]})
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
        self._login(user)
        self._error(self.api('GET', TARGETS_URL), 403, 'forbidden')

    def test_convert_targets_feature_gate_pmo_disabled_403(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        retained = [key for key in (profile.retained_read_features or []) if key != 'pmo.enabled']
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.enabled': False}, 'retained_read_features': retained})
        self._login(self.alice)
        response = self.api('GET', TARGETS_URL)
        self._error(response, 403, 'feature_not_included')
        self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': 'pmo.enabled'})
        task = self.make_personal_task(self.alice, 'gated')
        self._error(self._convert(task), 403, 'feature_not_included')
