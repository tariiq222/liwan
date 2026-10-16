# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from pathlib import Path
from unittest.mock import patch

from markupsafe import Markup

from odoo.fields import Command, Domain
from odoo.tests import tagged

from odoo.addons.webvue_tasks.serializers.personal_task import (
    dump_comment,
    dump_list_item,
    dump_personal_task,
    list_priority,
    list_state,
)
from odoo.addons.webvue_tasks.tests.common import WebVueTasksCase

DETAIL_KEYS = {
    'id', 'name', 'description', 'state', 'priority', 'date_deadline', 'assignees', 'creator',
    'parent', 'is_subtask', 'subtasks', 'attachment_count', 'created_at', 'updated_at', 'allowed_actions',
}
LIST_KEYS = {
    'id', 'name', 'state', 'priority', 'date_deadline', 'assignees', 'source', 'project', 'href',
}
COMMENT_KEYS = {'id', 'body', 'author', 'created_at'}
ACTION_KEYS = {'write', 'done', 'reopen', 'cancel', 'convert'}
GOLDEN = (
    Path(__file__).resolve().parents[3]
    / 'packages/contracts/src/tasks/__tests__/personal-task.golden.json'
)


@tagged('post_install', '-at_install', 'webvue', 'webvue_tasks')
class TestTaskSerializers(WebVueTasksCase):
    def _person(self, user):
        return {'id': user.id, 'name': user.name, 'user_id': user.id}

    def test_serializer_shape(self):
        Task = self.env['project.task'].with_user(self.alice)
        task = Task.create({
            'name': 'Write the report', 'company_id': self.alice.company_id.id,
            'description': '<p>First line</p><p>Second line</p>', 'priority': '1',
            'date_deadline': '2026-12-01 09:30:00', 'user_ids': [Command.set(self.alice.ids)],
        })
        service = self.env['webvue.my.task.service'].with_user(self.alice)
        child = service._create_task({'name': 'Child task', 'parent_id': task.id})
        service._transition(child, 'done')
        for name in ('a.txt', 'b.txt'):
            self.env['ir.attachment'].with_user(self.alice).create({
                'name': name, 'res_model': 'project.task', 'res_id': task.id,
                'raw': b'x', 'mimetype': 'text/plain',
            })
        self.env.flush_all()
        self.env.cr.execute(
            "UPDATE project_task SET create_date = %s, write_date = %s WHERE id = %s",
            ('2026-10-13 08:00:00', '2026-10-13 09:15:00', task.id))
        self.env.invalidate_all()
        task = task.with_user(self.alice)

        # Mirrors packages/contracts/src/tasks/__tests__/personal-task.golden.json, which the
        # Zod PersonalTaskSchema parses; keep the two in step (only the ids differ).
        expected = {
            'id': task.id,
            'name': 'Write the report',
            'description': 'First line\nSecond line',
            'state': 'open',
            'priority': 'high',
            'date_deadline': '2026-12-01T09:30:00Z',
            'assignees': [self._person(self.alice)],
            'creator': self._person(self.alice),
            'parent': None,
            'is_subtask': False,
            'subtasks': [{'id': child.id, 'name': 'Child task', 'state': 'done'}],
            'attachment_count': 2,
            'created_at': '2026-10-13T08:00:00Z',
            'updated_at': '2026-10-13T09:15:00Z',
            'allowed_actions': {
                'write': True, 'done': True, 'reopen': False, 'cancel': True, 'convert': False,
            },
        }
        detail = dump_personal_task(task)
        self.assertEqual(set(detail), DETAIL_KEYS)
        self.assertEqual(set(detail['allowed_actions']), ACTION_KEYS)
        self.assertEqual(detail['subtasks'][0].keys(), {'id', 'name', 'state'})
        self.assertEqual(detail, expected)
        self.assertEqual(detail['subtasks'], [{'id': child.id, 'name': 'Child task', 'state': 'done'}])

        # The same golden JSON the Zod PersonalTaskSchema parses: ids substituted, rest identical.
        if not GOLDEN.is_file():
            self.skipTest(f'{GOLDEN} is absent (packaged deploy without the contracts package)')
        golden = json.loads(GOLDEN.read_text())
        golden['id'] = task.id
        golden['subtasks'][0]['id'] = child.id
        for person in (*golden['assignees'], golden['creator']):
            person.update(id=self.alice.id, user_id=self.alice.id, name=self.alice.name)
        self.assertEqual(detail, golden)

        row = dump_list_item(task)
        self.assertEqual(set(row), LIST_KEYS)
        self.assertEqual(row, {
            'id': task.id, 'name': 'Write the report', 'state': 'open', 'priority': 'high',
            'date_deadline': '2026-12-01T09:30:00Z', 'assignees': [self._person(self.alice)],
            'source': 'personal', 'project': None, 'href': f'/my-tasks/{task.id}',
        })

        self.env['project.task'].browse(task.id).with_user(self.alice).message_post(
            body=Markup('<p>Looks good</p><p>Second</p>'), message_type='comment')
        message = task.message_ids.filtered(lambda m: m.message_type == 'comment')[:1]
        comment = dump_comment(message.with_user(self.alice))
        self.assertEqual(set(comment), COMMENT_KEYS)
        self.assertEqual(comment['body'], 'Looks good\nSecond')
        self.assertEqual(comment['author'], self._person(self.alice))
        self.assertRegex(comment['created_at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')

    def test_subtask_serializes_its_parent_and_hides_an_unreadable_one(self):
        parent = self.make_personal_task(self.alice, 'Parent', assignees=[self.alice.id])
        child = self.env['project.task'].with_user(self.alice).create({
            'name': 'Child', 'company_id': self.alice.company_id.id,
            'webvue_parent_id': parent.id, 'user_ids': [Command.set(self.bob.ids)],
        })
        self.assertEqual(dump_personal_task(child)['parent'], {'id': parent.id, 'name': 'Parent'})
        # Bob is assigned to the child only; the parent is private to Alice.
        seen = dump_personal_task(child.with_user(self.bob))
        self.assertIsNone(seen['parent'])
        self.assertTrue(seen['is_subtask'])
        self.assertTrue(dump_personal_task(child)['is_subtask'])
        self.assertFalse(dump_personal_task(parent)['is_subtask'])
        self.assertEqual(seen['name'], 'Child')

    # list rows of other applications

    def _project_task(self, state='03_approved', name='Project task'):
        project = self.env['project.project'].create({
            'name': 'Some project', 'company_id': self.alice.company_id.id})
        return self.env['project.task'].create({
            'name': name, 'project_id': project.id, 'state': state,
            'company_id': self.alice.company_id.id, 'user_ids': [Command.set(self.env.ref('base.user_admin').ids)],
        }), project

    def _patched_links(self, tasks, refs):
        """Make ``tasks`` join the list with ``refs`` ({task id: ref or None}), without the bridge."""
        links = type(self.env['webvue.task.links'])
        ids = tasks.ids
        return (
            patch.object(links, '_webvue_project_task_domain',
                         lambda _self, uid: Domain('id', 'in', ids)),
            patch.object(links, '_webvue_project_ref',
                         lambda _self, task: refs.get(task.id)),
        )

    def test_list_state_and_priority_map_every_foreign_value(self):
        for state, wire in (
            ('01_in_progress', 'open'), ('02_changes_requested', 'open'), ('03_approved', 'open'),
            ('04_waiting_normal', 'open'), ('1_done', 'done'), ('1_canceled', 'cancelled'),
            ('something_new', 'open'), (False, 'open'),
        ):
            with self.subTest(state=state):
                self.assertEqual(list_state(state), wire)
        self.assertEqual(
            [list_priority(v) for v in ('0', '1', '2', False, None)],
            ['normal', 'high', 'normal', 'normal', 'normal'])

    def test_list_item_of_a_project_task_in_a_pmo_state(self):
        task, project = self._project_task('03_approved')
        href = f'/projects/{project.id}/tasks/{task.id}'
        ref = {'id': project.id, 'name': project.name, 'href': href}
        domain_patch, ref_patch = self._patched_links(task, {task.id: ref})
        with domain_patch, ref_patch:
            row = dump_list_item(task)
            self.assertEqual(set(row), LIST_KEYS)
            self.assertEqual(row['state'], 'open')
            self.assertEqual(row['source'], 'project')
            self.assertEqual(row['project'], {'id': project.id, 'name': project.name})
            self.assertEqual(row['href'], href)
            rows, _total = self.env["webvue.my.task.service"].with_user(self.env.ref("base.user_admin"))._search_list(
                closed=False, q=None, assigned=True, created=False, sort='name', limit=50, offset=0)
        self.assertIn(task, rows)

    def test_list_drops_and_refuses_a_project_row_without_a_project_ref(self):
        good, project = self._project_task(name='Good')
        bad, _project = self._project_task(name='Bad')
        ref = {'id': project.id, 'name': project.name, 'href': f'/projects/{project.id}/tasks/{good.id}'}
        domain_patch, ref_patch = self._patched_links(good | bad, {good.id: ref, bad.id: None})
        with domain_patch, ref_patch:
            with self.assertRaises(ValueError):
                dump_list_item(bad)
            service = self.env['webvue.my.task.service'].with_user(self.env.ref('base.user_admin'))
            rows, total = service._search_list(
                closed=False, q=None, assigned=True, created=False, sort='name', limit=50, offset=0)
        self.assertIn(good, rows)
        self.assertNotIn(bad, rows)
        self.assertGreaterEqual(total, 2)  # the domain count, including the dropped row

    def test_subtasks_skip_archived_and_unreadable_children(self):
        service = self.env['webvue.my.task.service'].with_user(self.alice)
        parent = service._create_task({'name': 'Parent'})
        visible = service._create_task({'name': 'Visible', 'parent_id': parent.id})
        archived = service._create_task({'name': 'Archived', 'parent_id': parent.id})
        archived.sudo().write({'active': False})
        hidden = self.env['project.task'].with_user(self.bob).create({
            'name': 'Hidden', 'company_id': self.bob.company_id.id,
            'user_ids': [Command.set(self.bob.ids)],
        })
        hidden.sudo().write({'webvue_parent_id': parent.id})
        self.assertFalse(hidden.with_user(self.alice).has_access('read'))
        subtasks = dump_personal_task(parent.with_user(self.alice))['subtasks']
        self.assertEqual([row['id'] for row in subtasks], [visible.id])
