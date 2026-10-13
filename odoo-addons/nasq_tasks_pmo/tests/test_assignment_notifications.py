# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.common import NasqTasksCase


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestAssignmentNotificationsWithPmo(NasqTasksCase):
    def service(self, user):
        return self.env['nasq.my.task.service'].with_user(user)

    def rows(self, task, kind):
        return self.env['mail.message'].sudo().search([
            ('model', '=', 'project.task'), ('res_id', '=', task.id),
            ('nasq_notification', '=', True), ('nasq_notification_kind', '=', kind),
        ])

    def test_personal_task_assignment_creates_no_pmo_assignment_row(self):
        task = self.service(self.alice)._create_task({'name': 'P', 'assignees': [self.alice.id, self.bob.id]})
        self.assertTrue(task.nasq_personal)
        self.assertFalse(self.rows(task, 'assignment'))
        self.assertEqual(self.rows(task, 'tasks.assigned').partner_ids, self.bob.partner_id)

    def test_personal_task_user_ids_write_creates_no_pmo_assignment_row(self):
        task = self.service(self.alice)._create_task({'name': 'P', 'assignees': [self.alice.id]})
        self.service(self.alice)._update_task(task, {'assignees': [self.alice.id, self.carol.id]})
        self.assertFalse(self.rows(task, 'assignment'))
        self.assertEqual(self.rows(task, 'tasks.assigned').partner_ids, self.carol.partner_id)
        # The ORM path of the bridge's own create, bypassing the service, is silent too.
        other = self.make_personal_task(self.alice, assignees=[self.bob.id])
        other.write({'user_ids': [Command.link(self.carol.id)]})
        self.assertFalse(self.rows(other, 'assignment'))

    def test_project_task_assignment_still_emits_its_row(self):
        project = self.env['project.project'].create({'name': 'Assignment project'})
        task = self.env['project.task'].create({
            'name': 'Project task', 'project_id': project.id, 'user_ids': [Command.set([self.bob.id])],
        })
        self.assertEqual(self.rows(task, 'assignment').partner_ids, self.bob.partner_id)
        task.write({'user_ids': [Command.link(self.carol.id)]})
        self.assertEqual(self.rows(task, 'assignment').partner_ids, self.bob.partner_id | self.carol.partner_id)
