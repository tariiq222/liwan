# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``company_tax.enabled``: the derived key that tells the web client the tax section exists."""
from odoo.tests import tagged

from odoo.addons.liwan_api_account.tests.common import CompanyTaxCase

KEY = 'company_tax.enabled'


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyTaxEnabled(CompanyTaxCase):

    def platform(self, login='ct_employee'):
        self.sign_in(login)
        response = self.api('GET', '/api/v1/me')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['platform']

    def test_the_key_is_present_and_sorted_for_every_session(self):
        platform = self.platform()
        self.assertIn(KEY, platform['readable_features'])
        self.assertIn(KEY, platform['writable_features'])
        self.assertEqual(platform['readable_features'], sorted(platform['readable_features']))
        self.assertEqual(platform['writable_features'], sorted(platform['writable_features']))

    def test_it_is_not_a_registry_key_and_sells_nothing(self):
        self.assertNotIn(KEY, self.env['liwan.feature.registry']._liwan_feature_map())
