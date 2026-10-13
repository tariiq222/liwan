# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import tagged

from .common import NasqTasksCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestPersonalTaskRules(NasqTasksCase):
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
        self.assertFalse(task.nasq_personal)
        self.assertTrue(task.with_user(self.carol).has_access('read'))  # Odoo/PMO rules decide, ours passes

    # The tests below each guard one clause of rule_personal_task_visible: loosening
    # that clause (and nothing else) must turn the matching test red.

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

    def test_user_whose_current_company_differs_cannot_read(self):
        task = self.make_personal_task(self.alice, assignees=[self.alice.id, self.bob.id])
        main_company = task.company_id
        for user in (self.alice, self.bob):
            user.sudo().company_ids = [Command.link(self.other_company.id)]
            # Both companies stay allowed, so Odoo's own multi-company rule passes;
            # only the personal-task rule sees the other company as the current one.
            other = task.with_user(user).with_context(
                allowed_company_ids=[self.other_company.id, main_company.id])
            self.assertEqual(other.env.company, self.other_company)
            self.assertIn(main_company, other.env.companies)
            self.assertFalse(other.has_access('read'), user.login)
            # With nasq_pmo installed its own search gate may refuse the whole search in a
            # company where the user lacks pmo.tasks.read; a refusal also means "cannot read".
            try:
                found = other.search([('id', '=', task.id)])
            except AccessError:
                found = other.browse()
            self.assertFalse(found, user.login)
            self.assertTrue(task.with_user(user).has_access('read'), user.login)

    def test_personal_task_without_company_is_invisible_to_creator_and_assignee(self):
        task = self.make_personal_task(self.alice, assignees=[self.alice.id, self.bob.id])
        self.assertTrue(task.with_user(self.bob).has_access('read'))
        task.sudo().company_id = False
        self.assertTrue(task.nasq_personal)
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
