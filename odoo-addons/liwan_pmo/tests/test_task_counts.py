# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_pmo.serializers.task import task_counts

COUNT_KEYS = ('subtask_count', 'subtask_done_count', 'attachment_count')


@tagged('post_install', '-at_install', 'liwan')
class TestTaskCounts(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Task = cls.env['project.task']
        cls.parent = Task.create({
            'name': 'Parent', 'project_id': cls.project.id, 'user_ids': [(4, cls.employee.id)],
        })
        for name, state in (('Done A', '1_done'), ('Done B', '1_done'), ('Cancelled', '1_canceled'), ('Open', '01_in_progress')):
            Task.create({
                'name': name, 'project_id': cls.project.id, 'parent_id': cls.parent.id,
                'user_ids': [(4, cls.employee.id)], 'state': state,
            })
        cls.parent_childless = cls.task_overdue

    def _attach(self, task, name='file.txt', **vals):
        return self.env['ir.attachment'].create({
            'name': name, 'raw': b'content', 'res_model': 'project.task', 'res_id': task.id, **vals,
        })

    def _counts(self, item):
        return {key: item[key] for key in COUNT_KEYS}

    def _list_item(self, task):
        items = self.api('GET', '/api/v1/tasks?filter=mine&closed=0&limit=200').json()['items']
        return next(item for item in items if item['id'] == task.id)

    def test_task_without_subtasks_or_files_counts_zero(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        zero = {'subtask_count': 0, 'subtask_done_count': 0, 'attachment_count': 0}
        self.assertEqual(self._counts(self._list_item(self.task_overdue)), zero)
        self.assertEqual(self._counts(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()), zero)

    def test_subtasks_count_done_but_not_cancelled_or_open(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        expected = {'subtask_count': 4, 'subtask_done_count': 2, 'attachment_count': 0}
        self.assertEqual(self._counts(self._list_item(self.parent)), expected)
        detail = self.api('GET', f'/api/v1/tasks/{self.parent.id}').json()
        self.assertEqual(self._counts(detail), expected)
        self.assertEqual(len(detail['subtasks']), detail['subtask_count'])
        for subtask in detail['subtasks']:
            self.assertEqual(self._counts(subtask), {'subtask_count': 0, 'subtask_done_count': 0, 'attachment_count': 0})

    def test_archived_subtasks_are_not_counted(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.parent.child_ids.filtered(lambda t: t.name == 'Open').write({'active': False})
        self.assertEqual(self._list_item(self.parent)['subtask_count'], 3)
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.parent.id}').json()['subtask_count'], 3)

    def test_attachments_count_direct_binary_files_only(self):
        self._attach(self.parent, 'one.txt')
        self._attach(self.parent, 'two.txt')
        self._attach(self.parent, 'link', type='url', url='https://example.com', raw=False)
        self._attach(self.task_other, 'other task.txt')
        message = self.parent.message_post(body='with a file', attachment_ids=[self._attach(self.parent, 'chatter.txt').id])
        self.assertTrue(message.attachment_ids)
        self.authenticate('api_emp', 'api_emp_pass_123')
        detail = self.api('GET', f'/api/v1/tasks/{self.parent.id}').json()
        self.assertEqual([a['name'] for a in detail['attachments']], ['one.txt', 'two.txt'])
        self.assertEqual(detail['attachment_count'], 2)
        self.assertEqual(self._list_item(self.parent)['attachment_count'], 2)

    def test_attachment_order_is_stable_with_interleaved_uploads(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        # Different id offsets exercise the unordered stock relation, including
        # pairs separated in its set iteration order by unrelated uploads.
        for index in range(8):
            with self.subTest(index=index):
                task = self.env['project.task'].create({
                    'name': f'Attachment order {index}', 'project_id': self.project.id,
                    'user_ids': [(4, self.employee.id)],
                })
                self._attach(task, 'first.txt')
                self._attach(task, 'second.txt')
                self._attach(self.task_other, 'unrelated.txt')
                response = self.api('GET', f'/api/v1/tasks/{task.id}')
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(
                    [item['name'] for item in response.json()['attachments']],
                    ['first.txt', 'second.txt'],
                )

    def test_attachment_count_follows_upload_and_delete(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        upload = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', {
            'name': 'brief.txt', 'mimetype': 'text/plain', 'data': base64.b64encode(b'hello').decode(),
        })
        self.assertEqual(upload.status_code, 201, upload.text)
        self.assertEqual(self._list_item(self.task_overdue)['attachment_count'], 1)
        deleted = self.api('DELETE', f"/api/v1/tasks/{self.task_overdue.id}/attachments/{upload.json()['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self._list_item(self.task_overdue)['attachment_count'], 0)

    def test_counts_match_the_per_record_rules_for_every_task(self):
        self._attach(self.parent, 'one.txt')
        self.parent.message_post(body='file', attachment_ids=[self._attach(self.parent, 'chatter.txt').id])
        tasks = self.env['project.task'].search([('project_id', '=', self.project.id)])
        counts = task_counts(tasks.with_user(self.employee))
        for task in tasks.with_user(self.employee):
            self.assertEqual(counts[task.id], {
                'subtask_count': len(task.child_ids),
                'subtask_done_count': len(task.child_ids.filtered(lambda t: t.state == '1_done')),
                'attachment_count': len(task._liwan_task_attachments()),
            }, task.name)

    def test_counting_uses_a_constant_number_of_queries(self):
        one = self.parent.with_user(self.employee)
        many = self.env['project.task'].search([('project_id', '=', self.project.id)]).with_user(self.employee)
        self.assertGreater(len(many), 4)
        self._attach(self.parent, 'one.txt')
        self.parent.message_post(body='file', attachment_ids=[self._attach(self.parent, 'chatter.txt').id])
        self.env.flush_all()
        self.env.invalidate_all()
        before = self.cr.sql_log_count
        task_counts(one)
        single = self.cr.sql_log_count - before
        self.env.invalidate_all()
        before = self.cr.sql_log_count
        task_counts(many)
        bulk = self.cr.sql_log_count - before
        self.assertLessEqual(bulk, single + 1)
