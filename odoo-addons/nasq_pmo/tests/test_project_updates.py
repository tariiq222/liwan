# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqPmoCase

KEYS = {'id', 'name', 'status', 'description_html', 'date', 'author'}


@tagged('post_install', '-at_install', 'nasq')
class TestProjectUpdates(NasqPmoCase):

    def test_post_and_list(self):
        url = f'/api/v1/projects/{self.project.id}/updates'
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', url, {'status': 'on_track', 'name': 'x'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'status_forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'status': 'at_risk', 'name': 'Week 1', 'description': '<p>late</p>'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(set(res.json()), KEYS)
        self.assertEqual(res.json()['author']['id'], self.manager.id)
        self.api('POST', url, {'status': 'on_track', 'name': 'Week 2'})
        items = self.api('GET', url).json()
        self.assertEqual([u['name'] for u in items], ['Week 2', 'Week 1'])
        self.assertEqual(items[1]['description_html'], '<p>late</p>')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'on_track')
        self.assertEqual(self.api('POST', url, {'status': 'to_define', 'name': 'x'}).status_code, 422)
        self.assertEqual(self.api('POST', url, {'status': 'done', 'name': ' '}).status_code, 422)
        # the phase-2 quick status still works and lands in the list
        self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_hold'})
        self.assertEqual(self.api('GET', url).json()[0]['status'], 'on_hold')
