# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestTags(WebVuePmoCase):

    def test_list_and_create(self):
        self.env['project.tags'].create({'name': 'urgent'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/tags?q=urg').json()
        self.assertEqual([t['name'] for t in items], ['urgent'])
        self.assertEqual(set(items[0]), {'id', 'name', 'color'})
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self.api('POST', '/api/v1/tags', {'name': 'design'})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['name'], 'design')
        res = self.api('POST', '/api/v1/tags', {'name': 'Design'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'name'))
        res = self.api('POST', '/api/v1/tags', {'name': ' '})
        self.assertEqual(res.status_code, 422)
