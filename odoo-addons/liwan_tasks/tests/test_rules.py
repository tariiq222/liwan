# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import tagged

from .common import LiwanTasksCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestPersonalTaskRules(LiwanTasksCase):
    def test_creator_and_assignee_read(self):
        task = self.make_personal_task(self.alice, assignees=[self.bob.id])
        self.assertTrue(task.with_user(self.alice).has_access('read'))
        self.assertTrue(task.with_user(self.bob).has_access('read'))

    def test_stranger_cannot_read_or_search(self):
        task = self.make_personal_task(self.alice)
        self.assertFalse(task.with_user(self.carol).has_access('read'))
        found = self.env['project.task'].with_user(self.carol).search([('id', '=', task.id)])
        self.assertFalse(found)

    def test_follower_who_is_not_assignee_cannot_read(self):
        task = self.make_personal_task(self.alice)
        task.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        self.assertFalse(task.with_user(self.carol).has_access('read'))

    def test_other_company_creator_cannot_read(self):
        task = self.make_personal_task(self.alice)
        self.assertFalse(task.with_user(self.other_company_user).has_access('read'))

    def test_project_task_unaffected(self):
        project = self.env['project.project'].create({'name': 'p'})
        task = self.env['project.task'].create({'name': 'x', 'project_id': project.id})
        self.assertFalse(task.liwan_personal)
        self.assertTrue(task.with_user(self.carol).has_access('read'))  # Odoo/PMO rules decide, ours passes

    # The read tests below each guard one clause of rule_personal_task_visible: loosening
    # that clause (and nothing else) must turn the matching test red. The write tests
    # check combined behaviour (Odoo's own edition rule also applies), not one clause.

    def test_creator_who_is_not_assignee_reads_through_create_uid(self):
        task = self.make_personal_task(self.alice, assignees=[self.bob.id])
        # Odoo adds the creator as an assignee of a project-less task; remove it so
        # only the create_uid branch of the rule can let alice in.
        task.sudo().user_ids = [Command.set([self.bob.id])]
        self.assertNotIn(self.alice, task.user_ids)
        self.assertEqual(task.create_uid, self.alice)
        self.assertTrue(task.with_user(self.alice).has_access('read'))
        found = self.env['project.task'].with_user(self.alice).search([('id', '=', task.id)])
        self.assertEqual(found, task)

    def test_task_of_a_company_outside_the_pinned_set_cannot_read(self):
        task = self.make_personal_task(self.alice, assignees=[self.alice.id, self.bob.id])
        main_company = task.company_id
        # With liwan_pmo installed its search gate wants pmo.tasks.read in the current
        # company, so give both users the employee role in both companies: only the
        # personal-task rule can then refuse. (Any assignment makes the user "managed",
        # so the main company needs its own assignment too.)
        role = self.env.ref('liwan_core.role_employee')
        for user in (self.alice, self.bob):
            user.sudo().company_ids = [Command.link(self.other_company.id)]
            for company in (main_company, self.other_company):
                self.env['liwan.access.assignment'].create({
                    'user_id': user.id, 'role_id': role.id, 'company_id': company.id})
        for user in (self.alice, self.bob):
            # The rule follows the request's pinned company set: a session
            # pinned to the other company alone stays blind to the main
            # company's personal task, while the default (main-company)
            # session still reads it.
            other = task.with_user(user).with_context(
                allowed_company_ids=[self.other_company.id])
            self.assertEqual(other.env.company, self.other_company)
            self.assertNotIn(main_company, other.env.companies)
            self.assertFalse(other.has_access('read'), user.login)
            self.assertFalse(other.search([('id', '=', task.id)]), user.login)
            self.assertTrue(task.with_user(user).has_access('read'), user.login)

    def test_personal_task_without_company_is_invisible_to_creator_and_assignee(self):
        task = self.make_personal_task(self.alice, assignees=[self.alice.id, self.bob.id])
        self.assertTrue(task.with_user(self.bob).has_access('read'))
        task.sudo().company_id = False
        self.assertTrue(task.liwan_personal)
        for user in (self.alice, self.bob):
            self.assertFalse(task.with_user(user).has_access('read'), user.login)
            self.assertFalse(self.env['project.task'].with_user(user).search(
                [('id', '=', task.id)]), user.login)

    def test_stranger_and_follower_cannot_write_or_unlink(self):
        task = self.make_personal_task(self.alice)
        task.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        for operation in ('write', 'unlink'):
            for user in (self.carol, self.bob):
                with self.assertRaises(AccessError, msg=f'{user.login} {operation}'):
                    task.with_user(user).check_access(operation)
        with self.assertRaises(AccessError):
            task.with_user(self.carol).write({'name': 'hijacked'})
        self.assertEqual(task.name, 't')

    def test_creator_and_assignee_can_write(self):
        task = self.make_personal_task(self.alice, assignees=[self.bob.id])
        for user in (self.alice, self.bob):
            task.with_user(user).write({'name': f'by {user.login}'})
            self.assertEqual(task.name, f'by {user.login}')

    # A personal sub-task belongs to the participants of its parent: creator and assignees
    # of the parent read and write it, whoever made it. Nobody gains access to the parent.

    def _employees_with_role(self):
        role = self.env.ref('liwan_core.role_employee')
        for user in (self.alice, self.bob, self.carol):
            self.env['liwan.access.assignment'].create({
                'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})

    def _subtask_of_another_assignee(self):
        """alice and bob share a parent; bob alone makes (and is assigned to) the sub-task."""
        self._employees_with_role()
        parent = self.make_personal_task(self.alice, 'parent', assignees=[self.alice.id, self.bob.id])
        child = self.env['project.task'].with_user(self.bob).create({
            'name': 'bob child', 'company_id': self.env.company.id,
            'user_ids': [Command.set([self.bob.id])], 'liwan_parent_id': parent.id,
        })
        self.assertNotIn(self.alice, child.user_ids)
        self.assertNotEqual(child.create_uid, self.alice)
        return parent, child

    def test_parent_assignee_reads_and_writes_subtask_created_by_another_assignee(self):
        _parent, child = self._subtask_of_another_assignee()
        self.assertTrue(child.with_user(self.alice).has_access('read'))
        self.assertEqual(
            self.env['project.task'].with_user(self.alice).search([('id', '=', child.id)]), child)
        child.with_user(self.alice).write({'name': 'renamed by alice'})
        self.assertEqual(child.name, 'renamed by alice')

    def test_parent_creator_who_is_not_assignee_reads_and_writes_the_subtask(self):
        parent, child = self._subtask_of_another_assignee()
        parent.sudo().user_ids = [Command.set([self.bob.id])]
        self.assertNotIn(self.alice, parent.user_ids)
        self.assertEqual(parent.create_uid, self.alice)
        self.assertTrue(child.with_user(self.alice).has_access('read'))
        child.with_user(self.alice).write({'name': 'by the parent creator'})
        self.assertEqual(child.name, 'by the parent creator')

    def test_stranger_and_parent_follower_cannot_reach_the_subtask(self):
        parent, child = self._subtask_of_another_assignee()
        parent.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        child.sudo().message_subscribe(partner_ids=[self.carol.partner_id.id])
        self.assertFalse(child.with_user(self.carol).has_access('read'))
        self.assertFalse(self.env['project.task'].with_user(self.carol).search([('id', '=', child.id)]))
        with self.assertRaises(AccessError):
            child.with_user(self.carol).write({'name': 'hijacked'})

    def test_subtask_participant_gains_nothing_on_the_parent(self):
        parent, child = self._subtask_of_another_assignee()
        child.sudo().user_ids = [Command.set([self.bob.id, self.carol.id])]
        self.assertTrue(child.with_user(self.carol).has_access('read'))
        self.assertFalse(parent.with_user(self.carol).has_access('read'))

    def test_parent_participation_stops_with_the_company_clause(self):
        parent, child = self._subtask_of_another_assignee()
        (parent | child).sudo().company_id = self.other_company
        self.assertFalse(child.with_user(self.alice).has_access('read'))

    def test_a_parent_that_gained_a_project_behind_the_cache_is_not_a_valid_parent(self):
        parent = self.make_personal_task(self.alice, 'parent')
        project = self.env['project.project'].create({'name': 'p', 'company_id': self.env.company.id})
        self.assertFalse(parent.project_id)  # the parent's project is now cached empty
        # Another request converts the parent: the cached value is stale.
        self.env.cr.execute('UPDATE project_task SET project_id = %s WHERE id = %s', [project.id, parent.id])
        with self.assertRaises(ValidationError):
            self.env['project.task'].create({
                'name': 'late child', 'company_id': self.env.company.id, 'liwan_parent_id': parent.id})
