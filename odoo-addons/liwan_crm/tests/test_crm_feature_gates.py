# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The closed CRM feature refuses a caller holding no CRM capability before any capability check."""
from odoo.tests import tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

URL = '/api/v1/crm/opportunities'
IMPORTS = '/api/v1/crm/imports'
EXPORT = '/api/v1/crm/export'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmFeatureGates(LiwanCrmCase):

    def assert_feature_refused(self, response, label):
        self.assertEqual(response.status_code, 403, label)
        body = response.json()
        self.assertEqual(body['code'], 'feature_not_included', label)
        self.assertEqual(body['message'], 'this feature is not included', label)

    def test_the_closed_feature_refuses_every_crm_route_with_the_feature_code(self):
        lead = self.make_lead(self.agent)
        set_probe_feature(self, key='crm.enabled', enabled=False)
        routes = (
            ('GET', URL, None),
            ('POST', URL, {}),
            ('GET', f'{URL}/{lead.id}', None),
            ('GET', '/api/v1/crm/agents', None),
            ('GET', '/api/v1/crm/dashboard', None),
            ('GET', '/api/v1/crm/settings', None),
            ('GET', IMPORTS, None),
            ('GET', EXPORT, None),
            ('POST', f'{URL}/{lead.id}/calls', {}),
            ('POST', f'{URL}/{lead.id}/won', {}),
        )
        outsider = self.as_user(self.outsider)
        for method, path, body in routes:
            self.assert_feature_refused(outsider.api(method, path, json=body), f'{method} {path}')

    def test_the_import_sub_feature_is_separate(self):
        set_probe_feature(self, key='crm.import', enabled=False)
        outsider = self.as_user(self.outsider)
        self.assert_feature_refused(outsider.api('GET', IMPORTS), f'GET {IMPORTS}')
        self.assert_feature_refused(outsider.api('POST', f'{IMPORTS}/preview', json={}), f'POST {IMPORTS}/preview')
        listed = self.as_manager().api('GET', URL)
        self.assertEqual(listed.status_code, 200, listed.text)

    def test_the_export_sub_feature_is_separate(self):
        set_probe_feature(self, key='crm.export', enabled=False)
        outsider = self.as_user(self.outsider)
        self.assert_feature_refused(outsider.api('GET', EXPORT), f'GET {EXPORT}')
        listed = self.as_manager().api('GET', URL)
        self.assertEqual(listed.status_code, 200, listed.text)
