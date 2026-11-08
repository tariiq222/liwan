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
        body = self.api('GET', url).json()
        # The status change above is itself an update, so the log holds it plus the two posts.
        self.assertEqual(body['total'], 3)
        self.assertEqual([u['name'] for u in body['items'][:2]], ['Week 2', 'Week 1'])
        self.assertEqual(body['items'][1]['description_html'], '<p>late</p>')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'at_risk')
        # An update never changes the status: that belongs to project settings.
        res = self.api('POST', url, {'status': 'done', 'name': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'status'))
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['status'], 'at_risk')
        self.assertEqual(self.api('POST', url, {'name': ' '}).status_code, 422)
        # the phase-2 quick status still works and lands in the list
        self.api('POST', f'/api/v1/projects/{self.project.id}/status', {'status': 'on_hold'})
        self.assertEqual(self.api('GET', url).json()['items'][0]['status'], 'on_hold')

    def test_the_log_is_paged_with_a_true_total(self):
        """The old 50-row cap hid the rest of the log; the page stays 50 and `total` names the whole log."""
        url = f'/api/v1/projects/{self.project.id}/updates'
        updates = self.env['project.update'].create([
            {'project_id': self.project.id, 'status': 'on_track', 'name': f'Log {index}'}
            for index in range(51)
        ])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', url).json()
        self.assertEqual(len(body['items']), 50)
        self.assertEqual(body['total'], 51)
        second = self.api('GET', f'{url}?limit=50&offset=50').json()
        self.assertEqual((len(second['items']), second['total']), (1, 51))
        self.assertEqual(
            {item['id'] for item in body['items']} | {item['id'] for item in second['items']},
            set(updates.ids),
        )
        # A missing limit is the 50-row route default, not an unbounded page.
        self.assertEqual(len(self.api('GET', f'{url}?limit=0').json()['items']), 50)
        self.assertEqual(self.api('GET', f'{url}?limit=-1').status_code, 422)
