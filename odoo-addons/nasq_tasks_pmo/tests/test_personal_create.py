# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.common import NasqTasksCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestPersonalCreateWithPmo(NasqTasksCase):
    def _vals(self, user, **extra):
        return {
            'name': 'personal', 'company_id': user.company_id.id,
            'user_ids': [Command.set([user.id])], **extra,
        }

    def test_employee_creates_personal_task_with_pmo_installed(self):
        task = self.env['project.task'].with_user(self.alice).create(self._vals(
            self.alice, date_deadline='2026-12-01 09:00:00', priority='1',
            description='<p>details</p>',
        ))
        self.assertFalse(task.project_id)
        self.assertTrue(task.nasq_personal)
        self.assertEqual(task.user_ids, self.alice)
        self.assertEqual(task.priority, '1')
        self.assertTrue(task.with_user(self.alice).has_access('read'))

    def test_user_without_capability_cannot_create_projectless_task(self):
        # Leaving the employee role drops tasks.tasks.create; the group is a plain user.
        user = self.env['res.users'].create({
            'name': 'No tasks', 'login': 'tasks_nocap',
            'company_id': self.env.company.id, 'company_ids': [Command.set(self.env.company.ids)],
            'group_ids': [Command.set([self.env.ref('base.group_user').id])],
        })
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(user).create(self._vals(user))

    def test_projectless_create_with_foreign_field_rejected(self):
        for extra in ({'nasq_planned_start': '2026-12-01'}, {'partner_id': self.bob.partner_id.id}):
            with self.subTest(extra=extra), self.assertRaisesRegex(AccessError, 'Task fields are not allowed'):
                self.env['project.task'].with_user(self.alice).create(self._vals(self.alice, **extra))

    def test_projectless_create_cannot_set_a_state_or_stage(self):
        # state and stage_id are PMO create fields, but they carry project semantics.
        for extra in ({'state': '03_approved'}, {'state': '1_done'}):
            with self.subTest(extra=extra), self.assertRaises(AccessError):
                self.env['project.task'].with_user(self.alice).create(self._vals(self.alice, **extra))

    def test_subtask_of_project_task_rejected(self):
        project = self.env['project.project'].create({
            'name': 'p', 'company_id': self.env.company.id,
        })
        parent = self.env['project.task'].create({'name': 'parent', 'project_id': project.id})
        Task = self.env['project.task'].with_user(self.alice)
        # The hook never waives the project requirement for a project task's child ...
        self.assertFalse(Task._nasq_projectless_create_allowed(
            [self._vals(self.alice, parent_id=parent.id)]))
        # ... so PMO binds the child to the parent's project; it never becomes personal.
        child = Task.create(self._vals(self.alice, parent_id=parent.id))
        self.assertEqual(child.project_id, project)
        self.assertFalse(child.nasq_personal)

    def test_hook_accepts_a_personal_parent(self):
        # Odoo's project_task_private_task_has_no_parent constraint stops the INSERT of a
        # personal subtask, so this only documents the hook's answer.
        parent = self.make_personal_task(self.alice, 'parent')
        Task = self.env['project.task'].with_user(self.alice)
        self.assertTrue(Task._nasq_projectless_create_allowed(
            [self._vals(self.alice, parent_id=parent.id)]))

    def test_other_company_create_rejected(self):
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.alice).create(
                self._vals(self.alice, company_id=self.other_company.id))

    def test_project_task_create_unchanged(self):
        project = self.env['project.project'].create({
            'name': 'p', 'company_id': self.env.company.id,
        })
        Task = self.env['project.task'].with_user(self.alice)
        self.assertFalse(Task._nasq_projectless_create_allowed(
            [{'name': 'x', 'project_id': project.id}]))
        # Project tasks keep PMO's own gates: an approved state needs pmo.tasks.approve.
        with self.assertRaises(AccessError):
            Task.create({'name': 'x', 'project_id': project.id, 'state': '03_approved'})
