# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestTimeline(NasqPmoCase):

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
