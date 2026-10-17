# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from datetime import timedelta
from pathlib import Path

from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import WebVuePmoCase

SUMMARY_URL = '/api/v1/tasks/summary'
GOLDEN = (
    Path(__file__).resolve().parents[3]
    / 'packages/contracts/src/pmo/__tests__/task-summary.golden.json'
)


@tagged('post_install', '-at_install', 'webvue')
class TestTaskSummary(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Task = cls.env['project.task']
        now = fields.Datetime.now()
        cls.task_future = Task.create({
            'name': 'Future task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'date_deadline': now + timedelta(days=5),
        })
        cls.task_cancelled = Task.create({
            'name': 'Cancelled task', 'project_id': cls.project.id,
            'user_ids': [(4, cls.employee.id)], 'state': '1_canceled',
            'date_deadline': now - timedelta(days=2),
        })

    def _summary(self, query='?filter=mine'):
        response = self.api('GET', SUMMARY_URL + query)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_summary_matches_golden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        # overdue open, future open, done and cancelled (closed, so never overdue).
        self.assertEqual(self._summary(), json.loads(GOLDEN.read_text()))

    def test_summary_ignores_closed_and_paging_keys(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        expected = self._summary()
        self.assertEqual(self._summary('?filter=mine&closed=1&limit=1&offset=5'), expected)

    def test_summary_filters_like_the_list(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self._summary(f'?project_id={self.project.id}')['total'], 5)
        self.assertEqual(self._summary('?filter=mine&q=overdue'),
                         {'total': 1, 'open': 1, 'overdue': 1, 'done': 0})
        self.assertEqual(self._summary('?filter=mine&state=done'),
                         {'total': 1, 'open': 0, 'overdue': 0, 'done': 1})
        self.assertEqual(self._summary('?filter=mine&state=in_progress,cancelled'),
                         {'total': 3, 'open': 2, 'overdue': 1, 'done': 1})
        listed = self.api('GET', '/api/v1/tasks?filter=mine&q=task&closed=1').json()
        self.assertEqual(self._summary('?filter=mine&q=task')['done'], listed['total'])

    def test_summary_empty_set_is_all_zero(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        zero = {'total': 0, 'open': 0, 'overdue': 0, 'done': 0}
        self.assertEqual(self._summary('?filter=mine&q=no-such-task'), zero)
        empty_project = self.env['project.project'].create({'name': 'Empty', 'company_id': self.env.company.id})
        self.assertEqual(self._summary(f'?project_id={empty_project.id}'), zero)
        self.assertEqual(self._summary('?project_id=999999'), zero)
        self.project.write({'privacy_visibility': 'followers'})
        self.assertEqual(self._summary(f'?project_id={self.project.id}'), zero)

    def test_summary_rejects_bad_filters(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', SUMMARY_URL).status_code, 400)
        self.assertEqual(self.api('GET', SUMMARY_URL + '?filter=theirs').json()['code'], 'unsupported_filter')
        bad_state = self.api('GET', SUMMARY_URL + '?filter=mine&state=bogus')
        self.assertEqual((bad_state.status_code, bad_state.json()['field']), (422, 'state'))
        bad_project = self.api('GET', SUMMARY_URL + '?project_id=abc')
        self.assertEqual((bad_project.status_code, bad_project.json()['field']), (422, 'project_id'))

    def test_summary_excludes_other_companies(self):
        company_b = self.env['res.company'].create({'name': 'Summary company B'})
        foreign_project = self.env['project.project'].create({'name': 'Foreign', 'company_id': company_b.id})
        self.env['project.task'].create({
            'name': 'Foreign overdue', 'project_id': foreign_project.id, 'company_id': company_b.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': fields.Datetime.now() - timedelta(days=1),
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self._summary(), json.loads(GOLDEN.read_text()))
        self.assertEqual(self._summary(f'?project_id={foreign_project.id}')['total'], 0)

    def test_summary_requires_task_read_capability(self):
        role = self.env['webvue.access.role'].create({
            'name_ar': 'قارئ المشاريع فقط',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        reader = new_test_user(self.env, login='summary_reader', password='summary_reader_pass_123',
                               groups='base.group_user')
        self.env['webvue.access.assignment'].create({
            'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.authenticate('summary_reader', 'summary_reader_pass_123')
        response = self.api('GET', SUMMARY_URL + '?filter=mine')
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))


@tagged('post_install', '-at_install', 'webvue')
class TestTaskDescriptionExcerpt(WebVuePmoCase):

    def _excerpt(self, description):
        self.task_overdue.write({'description': description})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/tasks?filter=mine').json()['items']
        return next(t for t in items if t['id'] == self.task_overdue.id)['description_excerpt']

    def test_excerpt_is_one_plain_text_line(self):
        self.assertEqual(self._excerpt('<p>First   line</p><p>Second <br/>line</p>'), 'First line Second line')

    def test_excerpt_of_empty_description_is_empty(self):
        self.assertEqual(self._excerpt(False), '')
        self.assertEqual(self._excerpt('<p><br></p>'), '')

    def test_excerpt_is_truncated_to_140_characters(self):
        excerpt = self._excerpt('<p>' + 'word ' * 100 + '</p>')
        self.assertEqual(len(excerpt), 140)
        self.assertTrue(excerpt.endswith('…'))

    def test_excerpt_of_a_short_description_is_not_marked(self):
        self.assertEqual(self._excerpt('<p>' + 'x' * 140 + '</p>'), 'x' * 140)
