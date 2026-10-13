# Part of Odoo. See LICENSE file for full copyright and licensing details.
from markupsafe import Markup

from odoo.fields import Command
from odoo.tests import tagged

from odoo.addons.nasq_tasks.serializers.personal_task import (
    dump_comment,
    dump_list_item,
    dump_personal_task,
)
from odoo.addons.nasq_tasks.tests.common import NasqTasksCase

DETAIL_KEYS = {
    'id', 'name', 'description', 'state', 'priority', 'date_deadline', 'assignees', 'creator',
    'parent', 'subtasks', 'attachment_count', 'created_at', 'updated_at', 'allowed_actions',
}
LIST_KEYS = {
    'id', 'name', 'state', 'priority', 'date_deadline', 'assignees', 'source', 'project', 'href',
}
COMMENT_KEYS = {'id', 'body', 'author', 'created_at'}
ACTION_KEYS = {'write', 'done', 'reopen', 'cancel', 'convert'}


@tagged('post_install', '-at_install', 'nasq', 'nasq_tasks')
class TestTaskSerializers(NasqTasksCase):
    def _person(self, user):
        return {'id': user.id, 'name': user.name, 'user_id': user.id}

    def test_serializer_shape(self):
        Task = self.env['project.task'].with_user(self.alice)
        task = Task.create({
            'name': 'Write the report', 'company_id': self.alice.company_id.id,
            'description': '<p>First line</p><p>Second line</p>', 'priority': '1',
            'date_deadline': '2026-12-01 09:30:00', 'user_ids': [Command.set(self.alice.ids)],
        })
        service = self.env['nasq.my.task.service'].with_user(self.alice)
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
            'nasq_parent_id': parent.id, 'user_ids': [Command.set(self.bob.ids)],
        })
        self.assertEqual(dump_personal_task(child)['parent'], {'id': parent.id, 'name': 'Parent'})
        # Bob is assigned to the child only; the parent is private to Alice.
        seen = dump_personal_task(child.with_user(self.bob))
        self.assertIsNone(seen['parent'])
        self.assertEqual(seen['name'], 'Child')
