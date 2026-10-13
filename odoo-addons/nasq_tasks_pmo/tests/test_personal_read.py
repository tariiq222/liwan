# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_tasks.tests.common import NasqTasksCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestPersonalReadWithoutPmoCapability(NasqTasksCase):
    """A custom role with tasks.tasks.* and no pmo.tasks.* reaches personal tasks, never project tasks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user = new_test_user(
            cls.env, login='tasks_only', password='tasks_only_pass_123', groups='base.group_user')
        permissions = cls.env['nasq.access.permission'].search([('key', 'in', [
            'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'])])
        role = cls.env['nasq.access.role'].create({
            'name_ar': 'tasks only', 'permission_ids': [Command.set(permissions.ids)]})
        cls.env['nasq.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': cls.env.company.id})
        cls.tasks_only = user
        cls.project = cls.env['project.project'].create({
            'name': 'Visible project', 'company_id': cls.env.company.id})
        cls.project_task = cls.env['project.task'].create({
            'name': 'Project task', 'project_id': cls.project.id,
            'user_ids': [Command.set([user.id])]})

    def _service(self):
        return self.env['nasq.my.task.service'].with_user(self.tasks_only)

    def test_the_role_holds_no_pmo_capability(self):
        keys = self.env['nasq.access.service']._nasq_capability_keys(self.tasks_only)
        self.assertFalse({key for key in keys if key.startswith('pmo.')})

    def test_personal_task_lifecycle_through_the_service(self):
        service = self._service()
        task = service._create_task({'name': 'mine'})
        child = service._create_task({'name': 'step', 'parent_id': task.id})
        rows, total = service._search_list(
            closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)
        self.assertEqual((set(rows.ids), total), ({task.id}, 1))
        self.assertEqual(service._get_personal(task.id), task)
        self.assertEqual(service._get_personal(child.id), child)
        self.assertEqual(service._update_task(task, {'name': 'renamed'}).name, 'renamed')
        self.assertEqual(service._transition(task, 'done').state, '1_done')
        self.assertEqual(service._transition(task, 'reopen').state, '01_in_progress')
        self.assertTrue(service._allowed_actions(task)['write'])
        self.assertFalse(service._allowed_actions(task)['convert'])  # no pmo.tasks.create

    def test_project_tasks_stay_out_of_reach(self):
        Task = self.env['project.task'].with_user(self.tasks_only)
        with self.assertRaises(AccessError):
            Task.search([('id', '=', self.project_task.id)])
        self.assertFalse(self.project_task.with_user(self.tasks_only).has_access('read'))
        with self.assertRaises(AccessError):
            self.project_task.with_user(self.tasks_only).write({'name': 'x'})
        personal = self.make_personal_task(self.tasks_only, 'p')
        # A mixed set is refused as a whole: the project task fails PMO's gate.
        self.assertFalse((personal | self.project_task).with_user(self.tasks_only).has_access('read'))
        self.assertTrue(personal.with_user(self.tasks_only).has_access('read'))

    def test_crafted_domains_are_not_anchored(self):
        Task = self.env['project.task'].with_user(self.tasks_only)
        self.make_personal_task(self.tasks_only, 'p')
        for domain in (
            [],
            ['|', ('nasq_personal', '=', True), ('id', '>', 0)],
            [('project_id', '!=', False)],
            [('nasq_personal', '=', False)],
            ['!', ('nasq_personal', '=', True)],
        ):
            with self.subTest(domain=domain), self.assertRaises(AccessError):
                Task.search(domain)

    def test_anchored_domain_returns_personal_tasks_only(self):
        Task = self.env['project.task'].with_user(self.tasks_only)
        personal = self.make_personal_task(self.tasks_only, 'p')
        found = Task.search([('nasq_personal', '=', True), ('id', '>', 0)])
        self.assertEqual(found, personal)
        self.assertEqual(Task.search_count([('nasq_personal', '=', True)]), 1)

    def test_a_project_assignment_does_not_join_the_list_of_a_tasks_only_role(self):
        self.make_personal_task(self.tasks_only, 'p')
        rows, _total = self._service()._search_list(
            closed=False, q=None, assigned=True, created=True, sort='deadline', limit=50, offset=0)
        self.assertNotIn(self.project_task, rows)

    def test_user_without_tasks_read_gets_no_personal_access(self):
        # tasks.tasks.read is what the hook asks for: a plain employee-less user stays refused.
        user = new_test_user(self.env, login='tasks_nothing', groups='base.group_user')
        task = self.make_personal_task(self.alice, 'x', assignees=[self.alice.id, user.id])
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).search([('nasq_personal', '=', True)])
        self.assertFalse(task.with_user(user).has_access('read'))
