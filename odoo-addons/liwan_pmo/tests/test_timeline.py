# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestTimeline(LiwanPmoCase):

    def test_comment_then_timeline_mixes_tracking(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        tid = self.task_overdue.id
        res = self.api('POST', f'/api/v1/tasks/{tid}/comments', {'body': '<p>مرحبًا <b>فريق</b></p>'})
        self.assertEqual(res.status_code, 201)
        entry = res.json()
        self.assertEqual(entry['kind'], 'comment')
        self.assertEqual(entry['author']['name'], 'Sara')
        # The composer posts plain text, so authored markup comes back escaped
        # (see body_is_html=False in the controller) — the characters survive,
        # the tags do not.
        self.assertNotIn('<b>', entry['body_html'])
        self.assertIn('فريق', entry['body_html'])
        # a tracked change (priority is tracked in project.task)
        self.api('PATCH', f'/api/v1/tasks/{tid}', {'name': 'Renamed by test'})
        timeline = self.api('GET', f'/api/v1/tasks/{tid}/timeline').json()
        kinds = [e['kind'] for e in timeline]
        self.assertIn('comment', kinds)
        self.assertIn('tracking', kinds)
        tracking = next(e for e in timeline if e['kind'] == 'tracking')
        change = next(c for c in tracking['changes'] if c['field'] == 'name')
        self.assertEqual(change['old'], 'Overdue task')
        self.assertEqual(change['new'], 'Renamed by test')
        self.assertEqual(timeline[0]['kind'], 'tracking', 'newest first')

    def test_empty_comment_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {'body': '   '})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['field'], 'body')

    def test_script_is_sanitised(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {'body': '<script>alert(1)</script>hi'})
        self.assertEqual(res.status_code, 201)
        self.assertNotIn('<script', res.json()['body_html'])

    def test_comment_preserves_newlines(self):
        """A two-line comment must render as two lines, not one collapsed paragraph."""
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments',
                       {'body': 'السطر الأول\nالسطر الثاني'})
        self.assertEqual(res.status_code, 201)
        body = res.json()['body_html']
        self.assertIn('<br', body, "newline must become a line break")
        self.assertIn('السطر الأول', body)
        self.assertIn('السطر الثاني', body)

    def test_tracking_entry_carries_no_body_html(self):
        """Timeline.vue renders `changes` for tracking entries and never body_html."""
        self.authenticate('api_emp', 'api_emp_pass_123')
        tid = self.task_overdue.id
        self.api('PATCH', f'/api/v1/tasks/{tid}', {'name': 'Renamed for tracking'})
        timeline = self.api('GET', f'/api/v1/tasks/{tid}/timeline').json()
        tracking = [e for e in timeline if e['kind'] == 'tracking']
        self.assertTrue(tracking)
        for entry in tracking:
            self.assertNotIn('body_html', entry)

    def _subtask(self, name='Child task', parent=None):
        parent = parent or self.task_overdue
        return self.env['project.task'].create({
            'name': name, 'project_id': parent.project_id.id, 'parent_id': parent.id,
            'user_ids': [(6, 0, parent.user_ids.ids)],
        })

    def test_family_shares_one_comment_thread_but_not_the_log(self):
        child = self._subtask()
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{child.id}/comments', {'body': 'from child'}).status_code, 201)
        self.assertEqual(self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {'body': 'from parent'}).status_code, 201)
        self.api('PATCH', f'/api/v1/tasks/{child.id}', {'name': 'Child renamed'})
        for tid in (self.task_overdue.id, child.id):
            comments = [e for e in self.api('GET', f'/api/v1/tasks/{tid}/timeline').json() if e['kind'] == 'comment']
            self.assertEqual([c['task']['id'] for c in comments], [self.task_overdue.id, child.id], 'newest first, both pages')
        parent_log = [e for e in self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/timeline').json() if e['kind'] == 'tracking']
        self.assertFalse(any(c['field'] == 'name' and c['new'] == 'Child renamed' for e in parent_log for c in e['changes']))
        outsider = [e for e in self.api('GET', f'/api/v1/tasks/{self.task_done.id}/timeline').json() if e['kind'] == 'comment']
        self.assertFalse(outsider, 'an unrelated task does not join the conversation')

    def test_thread_tasks_lists_the_family_without_the_task_itself(self):
        child = self._subtask()
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/thread-tasks').json(), [{'id': child.id, 'name': 'Child task'}])
        self.assertEqual(
            self.api('GET', f'/api/v1/tasks/{child.id}/thread-tasks').json(),
            [{'id': self.task_overdue.id, 'name': self.task_overdue.name}],
        )

    def test_references_render_as_markup_and_stay_escaped(self):
        child = self._subtask(name='Fix <b>login</b>')
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/comments', {
            'body': f'@{self.manager.name} see /Fix <b>login</b> please',
            'mentions': [self.manager.id], 'task_refs': [child.id],
        })
        self.assertEqual(res.status_code, 201, res.text)
        html = res.json()['body_html']
        self.assertIn(f'<strong>@{self.manager.name}</strong>', html)
        self.assertIn(f'<a href="/tasks/{child.id}">/Fix &lt;b&gt;login&lt;/b&gt;</a>', html)
        self.assertNotIn('<b>login', html)

    def test_invalid_references_are_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/tasks/{self.task_overdue.id}/comments'
        for payload, field in (
            ({'body': 'x', 'mentions': 'nope'}, 'mentions'),
            ({'body': 'x', 'mentions': [self.manager.id, self.manager.id]}, 'mentions'),
            ({'body': 'x', 'mentions': [999999]}, 'mentions'),
            ({'body': 'x', 'task_refs': [True]}, 'task_refs'),
            ({'body': 'x', 'task_refs': [self.task_done.id]}, 'task_refs'),
        ):
            res = self.api('POST', url, payload)
            self.assertEqual(res.status_code, 422, payload)
            self.assertEqual(res.json()['field'], field)
