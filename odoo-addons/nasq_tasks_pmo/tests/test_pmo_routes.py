# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""PMO's own task routes reach personal tasks; they may only do what /my-tasks does."""
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.tests.routes_common import BASE, TasksRoutesCase

PMO = '/api/v1/tasks'
REFUSED = (403, 422)


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestPersonalTaskThroughPmoRoutes(TasksRoutesCase):

    def setUp(self):
        super().setUp()
        self.task = self.make_personal_task(self.alice, name='Mine', assignees=[self.alice.id, self.bob.id])
        self.sub = self.env['nasq.my.task.service'].with_user(self.alice)._create_task({
            'name': 'Sub', 'parent_id': self.task.id})

    def refused(self, login, method, path, body=None):
        status, payload = self.call(login, method, path, body)
        self.assertIn(status, REFUSED, payload)
        return payload

    def fresh(self, task=None):
        task = task or self.task
        task.invalidate_recordset()
        return task

    def test_pmo_transition_to_a_project_state_is_refused_and_leaves_the_task(self):
        for login in ('tasks_alice', 'tasks_bob'):
            for state in ('waiting', 'approved', 'changes_requested'):
                with self.subTest(login=login, state=state):
                    self.refused(login, 'POST', f'{PMO}/{self.task.id}/transition', {'state': state})
                    self.assertEqual(self.fresh().state, '01_in_progress')

    def test_pmo_archive_of_a_personal_task_is_refused(self):
        self.refused('tasks_alice', 'POST', f'{PMO}/{self.task.id}/archive')
        self.refused('tasks_bob', 'POST', f'{PMO}/{self.task.id}/archive')
        self.assertTrue(self.fresh().active)

    def test_pmo_patch_cannot_set_a_stage_or_tags(self):
        stage = self.env['project.task.type'].create({'name': 'Doing'})
        tag = self.env['project.tags'].create({'name': 'Hot'})
        self.refused('tasks_alice', 'PATCH', f'{PMO}/{self.task.id}', {'stage_id': stage.id})
        self.refused('tasks_alice', 'PATCH', f'{PMO}/{self.task.id}', {'tag_ids': [tag.id]})
        task = self.fresh()
        self.assertFalse(task.stage_id)
        self.assertFalse(task.tag_ids)

    def test_pmo_patch_assignees_are_refused_unless_they_are_people_of_the_company(self):
        outsider = self.other_company_user
        self.refused('tasks_alice', 'PATCH', f'{PMO}/{self.task.id}', {'user_ids': [outsider.id]})
        self.assertEqual(self.fresh().user_ids, self.alice | self.bob)
        status, payload = self.call('tasks_alice', 'PATCH', f'{PMO}/{self.task.id}', {'user_ids': [self.carol.id]})
        self.assertEqual(status, 200, payload)
        self.assertEqual(self.fresh().user_ids, self.carol)

    def test_pmo_patch_of_a_personal_field_still_works(self):
        status, payload = self.call('tasks_alice', 'PATCH', f'{PMO}/{self.task.id}', {'name': 'Renamed', 'priority': '1'})
        self.assertEqual(status, 200, payload)
        self.assertEqual(self.fresh().name, 'Renamed')

    def test_the_orm_guard_names_the_allowed_fields(self):
        task = self.task.with_user(self.alice)
        stage = self.env['project.task.type'].create({'name': 'Doing'})
        for vals in (
            {'state': '04_waiting_normal'}, {'state': '03_approved'}, {'active': False},
            {'stage_id': stage.id}, {'tag_ids': [Command.set([])]}, {'allocated_hours': 3},
            {'milestone_id': False}, {'personal_stage_type_id': stage.id},
        ):
            with self.subTest(vals=vals), self.assertRaises(AccessError):
                task.write(vals)
        task.write({'name': 'ok', 'description': '<p>d</p>', 'priority': '1', 'date_deadline': '2026-12-01 09:00:00'})
        task.write({'state': '1_done'})
        task.write({'state': '01_in_progress'})
        self.assertEqual(self.fresh().state, '01_in_progress')

    def test_my_tasks_edits_and_transitions_keep_working(self):
        path = f'{BASE}/{self.task.id}'
        self.ok('tasks_alice', 'PATCH', path, {'name': 'New name', 'priority': 'high', 'assignees': [self.alice.id]})
        for action in ('done', 'reopen', 'cancel', 'reopen'):
            self.ok('tasks_alice', 'POST', f'{path}/{action}')
        body = self.ok('tasks_alice', 'GET', path)
        self.assertEqual((body['name'], body['state'], body['priority']), ('New name', 'open', 'high'))

    def test_the_detail_never_fails_on_a_state_or_priority_forced_into_the_row(self):
        self.env.cr.execute(
            "UPDATE project_task SET state = '04_waiting_normal', priority = '3' WHERE id IN %s",
            [tuple((self.task | self.sub).ids)])
        self.env.invalidate_all()
        for task in (self.sub, self.task):
            body = self.ok('tasks_alice', 'GET', f'{BASE}/{task.id}')
            self.assertEqual((body['state'], body['priority']), ('open', 'normal'))
        parent = self.ok('tasks_alice', 'GET', f'{BASE}/{self.task.id}')
        self.assertEqual([item['state'] for item in parent['subtasks']], ['open'])
