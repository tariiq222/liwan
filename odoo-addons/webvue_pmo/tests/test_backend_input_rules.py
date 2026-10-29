# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import date

from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestTaskInputRules(WebVuePmoCase):
    """Create, schedule, archive-list and upload inputs are refused instead of being dropped."""

    def test_create_refuses_fields_it_does_not_write(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for field, value in (('user_ids', [1]), ('assignee_ids', [1]), ('stage_id', 1), ('priority', '3')):
            res = self.api('POST', '/api/v1/tasks', {'name': 'Strict', 'project_id': self.project.id, field: value})
            self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'unknown_field', field))
        self.assertFalse(self.env['project.task'].search([('name', '=', 'Strict')]))

    def test_schedule_outside_the_project_dates_is_422(self):
        project = self.env['project.project'].create({
            'name': 'Bounded', 'company_id': self.env.company.id, 'user_id': self.manager.id,
            'date_start': date(2027, 1, 1), 'date': date(2027, 3, 31),
        })
        task = self.env['project.task'].create({'name': 'Bounded task', 'project_id': project.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        url = f'/api/v1/projects/{project.id}/schedule/tasks/{task.id}'
        for start, end in (('2027-02-01', '2030-01-01'), ('2026-12-01', '2027-02-01')):
            res = self.api('PATCH', url, {'start': start, 'end': end})
            self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'), (start, end))
        ok = self.api('PATCH', url, {'start': '2027-02-01', 'end': '2027-03-31'})
        self.assertEqual(ok.status_code, 200, ok.text)

    def test_archived_list_validates_paging_before_the_scope(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for query in ('limit=-1', 'offset=-1', 'limit=abc'):
            res = self.api('GET', f'/api/v1/tasks/archived?{query}')
            self.assertEqual(res.status_code, 422, query)
        ok = self.api('GET', '/api/v1/tasks/archived?filter=mine&q=nothing&limit=1&offset=0')
        self.assertEqual((ok.status_code, ok.json()['total']), (200, 0))

    def test_upload_checks_name_length_extension_and_emptiness_and_reports_size(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/tasks/{self.task_overdue.id}/attachments'

        def upload(name, content):
            return self.api('POST', url, {'name': name, 'mimetype': 'text/plain', 'data': base64.b64encode(content).decode()})

        self.assertEqual(upload('x.pdf', b'abc').json()['field'], 'name')
        self.assertEqual(upload('a' * 300 + '.txt', b'abc').json()['field'], 'name')
        empty = upload('empty.txt', b'')
        self.assertEqual((empty.status_code, empty.json()['message']), (422, 'the file is empty'))
        good = upload('note.txt', b'abc')
        self.assertEqual((good.status_code, good.json()['size']), (201, 3))
        detail = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').json()
        self.assertEqual([item['size'] for item in detail['attachments']], [3])


@tagged('post_install', '-at_install', 'webvue')
class TestProjectDateEnd(WebVuePmoCase):

    def test_patch_accepts_date_end_like_get_and_post(self):
        self.project.write({'user_id': self.manager.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        url = f'/api/v1/projects/{self.project.id}'
        res = self.api('PATCH', url, {'date_end': '2030-11-15'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['date_end'], '2030-11-15')
        self.assertEqual(self.project.date, date(2030, 11, 15))
        both = self.api('PATCH', url, {'date': '2030-11-16', 'date_end': '2030-11-17'})
        self.assertEqual((both.status_code, both.json()['field']), (422, 'date_end'))
