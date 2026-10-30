# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase

KEYS = {'id', 'name', 'status', 'description_html', 'date', 'author'}


@tagged('post_install', '-at_install', 'liwan')
class TestProjectUpdates(LiwanPmoCase):

    def test_post_and_list(self):
        url = f'/api/v1/projects/{self.project.id}/updates'
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', url, {'name': 'x'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'status_forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'at_risk'})
        res = self.api('POST', url, {'name': 'Week 1', 'description': '<p>late</p>'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(set(res.json()), KEYS)
        self.assertEqual(res.json()['author']['id'], self.manager.id)
        self.assertEqual(res.json()['status'], 'at_risk')
        self.api('POST', url, {'name': 'Week 2'})
        items = self.api('GET', url).json()
        self.assertEqual([u['name'] for u in items[:2]], ['Week 2', 'Week 1'])
        self.assertEqual(items[1]['description_html'], '<p>late</p>')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'at_risk')
        # An update never changes the status: that belongs to project settings.
        res = self.api('POST', url, {'status': 'done', 'name': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'status'))
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'at_risk')
        self.assertEqual(self.api('POST', url, {'name': ' '}).status_code, 422)
        # the phase-2 quick status still works and lands in the list
        self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_hold'})
        self.assertEqual(self.api('GET', url).json()[0]['status'], 'on_hold')
