# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_tasks.serializers.personal_task import (
    dump_list_item,
    dump_personal_task,
)
from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestPersonalReadWithoutPmoCapability(LiwanTasksCase):
    """A custom role with tasks.tasks.* and no pmo.tasks.* reaches personal tasks, never project tasks.

    Every read below starts from a cold cache (``invalidate_all``): Odoo loads the columns
    of a record through a search whose domain carries no personal-task leaf, which is the
    path a real request takes.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tasks_only = cls._role_user('tasks_only', [
            'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'])
        cls.project = cls.env['project.project'].create({
            'name': 'Visible project', 'company_id': cls.env.company.id})
        cls.project_task = cls.env['project.task'].create({
            'name': 'Project task', 'project_id': cls.project.id,
            'user_ids': [Command.set([cls.tasks_only.id])]})

    @classmethod
    def _role_user(cls, login, keys):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', groups='base.group_user')
        permissions = cls.env['liwan.access.permission'].search([('key', 'in', keys)])
        role = cls.env['liwan.access.role'].create({
            'name_ar': login, 'permission_ids': [Command.set(permissions.ids)]})
        cls.env['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id})
        return user

    def _service(self):
        return self.env['liwan.my.task.service'].with_user(self.tasks_only)

    def _list(self):
        return self._service()._search_list(
            closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)

    def _fields_of(self, tasks):
        """Read what a serializer reads: plain columns, a relation and the assignee names."""
        return [
            (task.name, task.state, task.company_id.id, task.date_deadline, task.priority,
             task.user_ids.mapped('name'), task.liwan_parent_id.id, task.project_id.id)
            for task in tasks
        ]

    def test_the_role_holds_no_pmo_capability(self):
        keys = self.env['liwan.access.service']._liwan_capability_keys(self.tasks_only)
        self.assertFalse({key for key in keys if key.startswith('pmo.')})

    def test_list_rows_are_readable_from_a_cold_cache(self):
        task = self._service()._create_task({'name': 'mine', 'date_deadline': '2026-12-01T09:00:00Z'})
        self.env.invalidate_all()
        rows, total = self._list()
        self.assertEqual((rows.ids, total), (task.ids, 1))
        self.env.invalidate_all()
        self.assertEqual(self._fields_of(rows)[0][:2], ('mine', '01_in_progress'))
        self.assertEqual(rows[:1].name, 'mine')

    def test_detail_and_actions_from_a_cold_cache(self):
        service = self._service()
        task = service._create_task({'name': 'mine'})
        self.env.invalidate_all()
        self.assertEqual(service._get_personal(task.id).name, 'mine')
        self.env.invalidate_all()
        self.assertEqual(service._update_task(task, {'name': 'renamed'}).name, 'renamed')
        self.env.invalidate_all()
        self.assertEqual(service._transition(task, 'done').state, '1_done')
        self.env.invalidate_all()
        self.assertEqual(service._transition(task, 'reopen').state, '01_in_progress')
        self.env.invalidate_all()
        self.assertTrue(service._allowed_actions(task)['write'])
        self.assertFalse(service._allowed_actions(task)['convert'])  # no pmo.tasks.create

    def test_subtask_with_a_cold_parent(self):
        service = self._service()
        parent = service._create_task({'name': 'parent'})
        self.env.invalidate_all()
        child = service._create_task({'name': 'step', 'parent_id': parent.id})
        self.env.invalidate_all()
        self.assertEqual(service._get_personal(child.id).liwan_parent_id.id, parent.id)
        self.env.invalidate_all()
        self.assertEqual(self._fields_of(service._get_personal(child.id))[0][0], 'step')

    def test_serializers_read_from_a_cold_cache(self):
        service = self._service()
        parent = service._create_task({
            'name': 'parent', 'description': 'some text', 'priority': 'high',
            'date_deadline': '2026-12-01T09:00:00Z',
            'assignees': [self.tasks_only.id, self.alice.id]})
        child = service._create_task({'name': 'step', 'parent_id': parent.id})
        self.env['ir.attachment'].with_user(self.tasks_only).create({
            'name': 'a.txt', 'res_model': 'project.task', 'res_id': parent.id,
            'raw': b'x', 'mimetype': 'text/plain'})
        self.env.flush_all()
        self.env.invalidate_all()
        rows, _total = self._list()
        self.env.invalidate_all()
        item = dump_list_item(rows)
        self.assertEqual(
            (item['id'], item['name'], item['state'], item['priority'], item['source'], item['project']),
            (parent.id, 'parent', 'open', 'high', 'personal', None))
        self.assertEqual(item['date_deadline'], '2026-12-01T09:00:00Z')
        self.assertCountEqual(
            [person['id'] for person in item['assignees']], [self.tasks_only.id, self.alice.id])
        self.env.invalidate_all()
        detail = dump_personal_task(service._get_personal(parent.id))
        self.assertEqual((detail['name'], detail['description'], detail['attachment_count']),
                         ('parent', 'some text', 1))
        self.assertEqual(detail['creator']['id'], self.tasks_only.id)
        self.assertEqual(detail['subtasks'], [{'id': child.id, 'name': 'step', 'state': 'open'}])
        self.assertTrue(detail['allowed_actions']['write'])
        self.env.invalidate_all()
        sub_detail = dump_personal_task(service._get_personal(child.id))
        self.assertEqual(sub_detail['parent'], {'id': parent.id, 'name': 'parent'})
        self.assertRegex(sub_detail['created_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')

    def test_a_pmo_tasks_reader_without_projects_read_still_lists_personal_tasks(self):
        user = self._role_user('tasks_pmo_tasks_reader', [
            'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write', 'pmo.tasks.read'])
        personal = self.make_personal_task(user, 'p')
        self.env.invalidate_all()
        rows, total = self._service().with_user(user)._search_list(
            closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)
        self.assertEqual((rows, total), (personal.with_user(user), 1))
        self.assertNotIn(self.project_task, rows)

    def test_project_tasks_stay_out_of_reach(self):
        Task = self.env['project.task'].with_user(self.tasks_only)
        self.env.invalidate_all()
        self.assertFalse(Task.search([('id', '=', self.project_task.id)]))
        self.assertFalse(self.project_task.with_user(self.tasks_only).has_access('read'))
        self.env.invalidate_all()
        with self.assertRaises(AccessError):
            self.project_task.with_user(self.tasks_only).name  # noqa: B018
        with self.assertRaises(AccessError):
            self.project_task.with_user(self.tasks_only).write({'name': 'x'})

    def test_crafted_domains_stay_refused_or_personal_only(self):
        Task = self.env['project.task'].with_user(self.tasks_only)
        personal = self.make_personal_task(self.tasks_only, 'p')
        self.env.invalidate_all()
        # Every search is narrowed to personal tasks: nothing of a project can come back.
        for domain in (
            [],
            ['|', ('liwan_personal', '=', True), ('id', '>', 0)],
            [('project_id', '!=', False)],
            [('liwan_personal', '=', False)],
            ['!', ('liwan_personal', '=', True)],
        ):
            with self.subTest(domain=domain):
                found = Task.search(domain)
                self.assertNotIn(self.project_task, found)
                self.assertLessEqual(set(found.ids), set(personal.ids))
        self.assertEqual(Task.search([]), personal)
        # A path through the project needs pmo.projects.read on the project search itself.
        with self.assertRaises(AccessError):
            Task.search([('project_id.name', '=', 'Visible project')])

    def test_mixed_recordset_refuses_only_the_project_task(self):
        personal = self.make_personal_task(self.tasks_only, 'p')
        mixed = (personal | self.project_task).with_user(self.tasks_only)
        self.env.invalidate_all()
        self.assertFalse(mixed.has_access('read'))
        self.assertEqual(mixed._filtered_access('read'), personal.with_user(self.tasks_only))
        self.assertTrue(personal.with_user(self.tasks_only).has_access('read'))

    def test_a_project_assignment_does_not_join_the_list_of_a_tasks_only_role(self):
        self.make_personal_task(self.tasks_only, 'p')
        self.env.invalidate_all()
        rows, _total = self._list()
        self.assertNotIn(self.project_task, rows)

    def test_user_without_tasks_read_gets_no_personal_access(self):
        user = new_test_user(self.env, login='tasks_nothing', groups='base.group_user')
        task = self.make_personal_task(self.alice, 'x', assignees=[self.alice.id, user.id])
        self.env.invalidate_all()
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).search([('liwan_personal', '=', True)])
        self.assertFalse(task.with_user(user).has_access('read'))

    def test_pmo_tasks_write_decides_a_project_task_not_a_personal_one(self):
        user = self._role_user('tasks_pmo_reader', [
            'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write',
            'pmo.projects.read', 'pmo.tasks.read'])
        project_task = self.env['project.task'].create({
            'name': 'Assigned project task', 'project_id': self.project.id,
            'user_ids': [Command.set([user.id])]})
        personal = self.make_personal_task(user, 'personal')
        self.env.invalidate_all()
        with self.assertRaises(AccessError):
            project_task.with_user(user).write({'name': 'renamed'})
        personal.with_user(user).write({'name': 'renamed'})
        self.assertEqual(personal.name, 'renamed')
