# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.common import NasqTasksCase

KEY = 'tasks.assigned:{}:{}'


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestTaskNotifications(NasqTasksCase):
    def service(self, user):
        return self.env['nasq.my.task.service'].with_user(user)

    def rows(self, task, user):
        return self.env['mail.message'].sudo().search([
            ('nasq_notification_key', '=', KEY.format(task.id, user.partner_id.id)),
        ])

    def bell(self, user):
        return self.env['nasq.notify.service'].with_user(user)._nasq_list(50)['items']

    def test_assignment_notifies_other_user_once(self):
        task = self.service(self.alice)._create_task({'name': 'Plan', 'assignees': [self.bob.id]})
        rows = self.rows(task, self.bob)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows.nasq_notification_kind, 'tasks.assigned')
        self.assertEqual(rows.nasq_tasks_task_id, task.id)
        self.assertEqual(rows.nasq_tasks_task_name, 'Plan')
        items = self.bell(self.bob)
        self.assertEqual([(i['kind'], i['task_id'], i['task_name']) for i in items],
                         [('tasks.assigned', task.id, 'Plan')])
        self.assertFalse(self.rows(task, self.alice))

    def test_self_assignment_sends_nothing(self):
        task = self.service(self.alice)._create_task({'name': 'Mine', 'assignees': [self.alice.id]})
        self.assertFalse(self.rows(task, self.alice))
        self.assertEqual(self.bell(self.alice), [])

    def test_reassignment_replaces_the_row(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        self.service(self.alice)._update_task(task, {'assignees': [self.alice.id]})
        self.service(self.alice)._update_task(task, {'assignees': [self.bob.id, self.alice.id]})
        self.assertEqual(len(self.rows(task, self.bob)), 1)
        self.assertEqual(len(self.bell(self.bob)), 1)

    def test_update_notifies_only_new_assignees(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        self.service(self.alice)._update_task(task, {'assignees': [self.bob.id, self.carol.id]})
        self.assertEqual(len(self.rows(task, self.carol)), 1)
        self.assertEqual(len(self.rows(task, self.bob)), 1)

    def test_subtask_assignment_notifies(self):
        parent = self.service(self.alice)._create_task({'name': 'P', 'assignees': [self.alice.id]})
        sub = self.service(self.alice)._create_task(
            {'name': 'S', 'parent_id': parent.id, 'assignees': [self.bob.id]})
        self.assertEqual(len(self.rows(sub, self.bob)), 1)

    def test_removed_assignee_row_not_visible_in_bell(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        self.assertEqual(len(self.bell(self.bob)), 1)
        self.service(self.alice)._update_task(task, {'assignees': [self.alice.id]})
        self.assertEqual(self.bell(self.bob), [])

    def test_bell_row_for_unreadable_task_hidden(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        self.assertEqual(len(self.bell(self.bob)), 1)
        task.sudo().write({'company_id': self.other_company.id})
        self.assertEqual(self.bell(self.bob), [])
        task.sudo().write({'company_id': self.alice.company_id.id, 'user_ids': [Command.clear()]})
        self.assertEqual(self.bell(self.bob), [])

    def test_people_picker_lists_for_tasks_feature(self):
        keys = self.env['nasq.directory']._nasq_directory_feature_keys()
        self.assertIn('tasks.enabled', keys)
        self.authenticate('tasks_alice', 'tasks_alice_pass_123')
        items = self.api('GET', '/api/v1/people?q=Bob').json()
        self.assertEqual(items, [{'id': self.bob.id, 'name': 'Bob', 'user_id': self.bob.id}])
