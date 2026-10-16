# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestProjectFollowers(WebVuePmoCase):

    def test_followers_and_visibility(self):
        url = f'/api/v1/projects/{self.project.id}/followers'
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.api('PATCH', f'/api/v1/projects/{self.project.id}', {'privacy_visibility': 'followers'})
        before = {u['id'] for u in self.api('GET', url).json()}
        self.assertNotIn(self.employee.id, before)
        # employee (assigned to a task but not a follower) cannot open the project
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', url, {'user_id': self.employee.id})
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.employee.id, {u['id'] for u in res.json()})
        self.assertEqual(set(res.json()[0]), {'id', 'name'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').status_code, 200)
        self.assertEqual(self.api('POST', url, {'user_id': self.manager.id}).status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('DELETE', f'{url}/{self.employee.id}')
        self.assertNotIn(self.employee.id, {u['id'] for u in res.json()})
        self.assertEqual(self.api('POST', url, {'user_id': 999999}).status_code, 422)
