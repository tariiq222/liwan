# Part of Odoo. See LICENSE file for full copyright and licensing details.
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
