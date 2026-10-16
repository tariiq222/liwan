# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.webvue_tasks.tests.common import WebVueTasksCase


@tagged('post_install', '-at_install', 'webvue', 'webvue_tasks')
class TestPersonalCreateWithPmo(WebVueTasksCase):
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
        self.assertTrue(task.webvue_personal)
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
        for extra in ({'webvue_planned_start': '2026-12-01'}, {'partner_id': self.bob.partner_id.id}):
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
        # A project task is never the parent of a personal sub-task: the hook refuses ...
        self.assertFalse(Task._webvue_projectless_create_allowed(
            [self._vals(self.alice, webvue_parent_id=parent.id)]))
        # ... so PMO's project requirement stands and the create is refused.
        with self.assertRaises(AccessError):
            Task.create(self._vals(self.alice, webvue_parent_id=parent.id))
        # Odoo's own parent_id on a project-less create is not a personal field.
        self.assertFalse(Task._webvue_projectless_create_allowed(
            [self._vals(self.alice, parent_id=parent.id)]))
        # A child of a project task through parent_id still binds to the parent's project.
        child = Task.create(self._vals(self.alice, parent_id=parent.id))
        self.assertEqual(child.project_id, project)
        self.assertFalse(child.webvue_personal)

    def test_personal_subtask_can_be_created_with_pmo_installed(self):
        parent = self.make_personal_task(self.alice, 'parent')
        Task = self.env['project.task'].with_user(self.alice)
        vals = self._vals(self.alice, webvue_parent_id=parent.id)
        self.assertTrue(Task._webvue_projectless_create_allowed([vals]))
        child = Task.create(vals)
        self.assertTrue(child.webvue_personal)
        self.assertEqual(child.webvue_parent_id, parent)
        self.assertFalse(child.parent_id)
        self.assertEqual(parent.webvue_child_ids, child)
        self.assertTrue(child.with_user(self.alice).has_access('read'))

    def test_other_company_create_rejected(self):
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.alice).create(
                self._vals(self.alice, company_id=self.other_company.id))

    def test_project_task_create_unchanged(self):
        project = self.env['project.project'].create({
            'name': 'p', 'company_id': self.env.company.id,
        })
        Task = self.env['project.task'].with_user(self.alice)
        self.assertFalse(Task._webvue_projectless_create_allowed(
            [{'name': 'x', 'project_id': project.id}]))
        # Project tasks keep PMO's own gates: an approved state needs pmo.tasks.approve.
        with self.assertRaises(AccessError):
            Task.create({'name': 'x', 'project_id': project.id, 'state': '03_approved'})

    def test_mixed_vals_list_rejected_as_a_whole(self):
        project = self.env['project.project'].create({
            'name': 'p', 'company_id': self.env.company.id,
        })
        mixed = [self._vals(self.alice), {'name': 'in project', 'project_id': project.id}]
        Task = self.env['project.task'].with_user(self.alice)
        self.assertFalse(Task._webvue_projectless_create_allowed(mixed))
        with self.assertRaises(AccessError):
            Task.create(mixed)

    def test_default_company_context_cannot_choose_the_company(self):
        # alice may create in her own company only; the other company is merely allowed.
        self.alice.sudo().company_ids = [Command.link(self.other_company.id)]
        Task = self.env['project.task'].with_user(self.alice).with_context(
            allowed_company_ids=[self.env.company.id, self.other_company.id],
            default_company_id=self.other_company.id,
        )
        self.assertEqual(Task.env.company, self.env.company)
        vals = {'name': 'sneaky', 'user_ids': [Command.set([self.alice.id])]}
        self.assertFalse(Task._webvue_projectless_create_allowed([vals]))
        with self.assertRaises(AccessError):
            Task.create(vals)

    def test_default_state_context_cannot_ride_on_a_personal_create(self):
        Task = self.env['project.task'].with_user(self.alice).with_context(
            default_state='03_approved')
        with self.assertRaises(AccessError):
            Task.create(self._vals(self.alice))

    def test_default_project_context_binds_the_task_to_that_project(self):
        project = self.env['project.project'].create({
            'name': 'p', 'company_id': self.env.company.id,
        })
        Task = self.env['project.task'].with_user(self.alice).with_context(
            default_project_id=project.id)
        # PMO merges the default before the hook runs, so the hook never sees a project-less
        # personal create and the task goes through PMO's project path.
        task = Task.create(self._vals(self.alice))
        self.assertEqual(task.project_id, project)
        self.assertFalse(task.webvue_personal)

    def test_unreadable_parent_is_answered_false_not_raised(self):
        hidden = self.make_personal_task(self.bob, name='bob only', assignees=[self.bob.id])
        Task = self.env['project.task'].with_user(self.alice)
        self.assertFalse(hidden.with_user(self.alice).has_access('read'))
        self.env.invalidate_all()  # a cold cache, as in a request: reading the parent checks access
        self.assertFalse(Task._webvue_projectless_create_allowed(
            [self._vals(self.alice, webvue_parent_id=hidden.id)]))
        with self.assertRaises(AccessError):
            Task.create(self._vals(self.alice, webvue_parent_id=hidden.id))
