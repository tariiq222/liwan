# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import tagged
from odoo.tools import plaintext2html

from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestCommentNotificationsWithPmo(LiwanTasksCase):
    def comment_rows(self, task):
        return self.env['mail.message'].sudo().search([
            ('model', '=', 'project.task'), ('res_id', '=', task.id),
            ('liwan_notification', '=', True), ('liwan_notification_kind', '=', 'comment'),
        ])

    def post(self, task):
        return task.message_post(
            body=plaintext2html('hi'), message_type='comment', subtype_xmlid='mail.mt_comment',
            author_id=self.alice.partner_id.id)

    def test_personal_task_comment_creates_no_pmo_bell_row(self):
        task = self.make_personal_task(self.alice, assignees=[self.alice.id, self.bob.id])
        self.post(task)
        self.assertFalse(self.comment_rows(task))

    def test_project_task_comment_still_notifies_the_assignees(self):
        project = self.env['project.project'].create({'name': 'Bell project'})
        task = self.env['project.task'].create({
            'name': 'Project task', 'project_id': project.id,
            'user_ids': [Command.set([self.alice.id, self.bob.id])],
        })
        self.post(task)
        self.assertEqual(self.comment_rows(task).partner_ids, self.bob.partner_id)
