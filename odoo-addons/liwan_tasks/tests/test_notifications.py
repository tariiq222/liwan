# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase

KEY = 'tasks.assigned:{}:{}'


@tagged('post_install', '-at_install', 'liwan', 'liwan_tasks')
class TestTaskNotifications(LiwanTasksCase):
    def service(self, user):
        return self.env['liwan.my.task.service'].with_user(user)

    def rows(self, task, user):
        return self.env['mail.message'].sudo().search([
            ('liwan_notification_key', '=', KEY.format(task.id, user.partner_id.id)),
        ])

    def bell(self, user):
        return self.env['liwan.notify.service'].with_user(user)._liwan_list(50)['items']

    def test_assignment_notifies_other_user_once(self):
        task = self.service(self.alice)._create_task({'name': 'Plan', 'assignees': [self.bob.id]})
        rows = self.rows(task, self.bob)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows.liwan_notification_kind, 'tasks.assigned')
        self.assertEqual(rows.liwan_tasks_task_id, task.id)
        self.assertEqual(rows.liwan_tasks_task_name, 'Plan')
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

    def test_readd_after_removal_sends_a_fresh_unread_row(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        old = self.rows(task, self.bob)
        old.notification_ids.sudo().write({'is_read': True})
        old.sudo().write({'date': '2020-01-01 00:00:00'})
        self.service(self.alice)._update_task(task, {'assignees': [self.alice.id]})
        self.service(self.alice)._update_task(task, {'assignees': [self.alice.id, self.bob.id]})
        rows = self.rows(task, self.bob)
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows.notification_ids.is_read)
        self.assertGreater(str(rows.date), '2020-01-01 00:00:00')
        self.assertEqual(rows.author_id, self.alice.partner_id)
        items = self.bell(self.bob)
        self.assertEqual((len(items), items[0]['is_read'], items[0]['title']), (1, False, 'T'))

    def test_resave_with_unchanged_assignees_sends_nothing_new(self):
        task = self.service(self.alice)._create_task({'name': 'T', 'assignees': [self.bob.id]})
        first = self.rows(task, self.bob)
        first.notification_ids.sudo().write({'is_read': True})
        self.service(self.alice)._update_task(task, {'assignees': [self.bob.id], 'name': 'T2'})
        self.assertEqual(self.rows(task, self.bob), first)
        self.assertTrue(first.notification_ids.is_read)

    def test_feature_off_sends_nothing(self):
        set_probe_feature(self, 'tasks.enabled', enabled=False)
        task = self.make_personal_task(self.alice, assignees=[self.bob.id])
        self.service(self.alice)._notify_assigned(task, task.user_ids.browse())
        self.assertFalse(self.rows(task, self.bob))

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
        keys = self.env['liwan.directory']._liwan_directory_feature_keys()
        self.assertIn('tasks.enabled', keys)
        self.authenticate('tasks_alice', 'tasks_alice_pass_123')
        items = self.api('GET', '/api/v1/people?q=Bob').json()
        self.assertEqual(items, [{'id': self.bob.id, 'name': 'Bob', 'user_id': self.bob.id}])
