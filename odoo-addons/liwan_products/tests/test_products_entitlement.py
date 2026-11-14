# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``products.enabled``: the derived key that tells the web client whether the products routes are open."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_products.tests.common import ProductsCase

KEY = 'products.enabled'


@tagged('post_install', '-at_install', 'liwan')
class TestProductsEnabled(ProductsCase):

    def platform(self):
        self.sign_in('pr_a_staff')
        return self.me()['platform']

    def test_it_is_not_a_registry_key(self):
        self.assertNotIn(KEY, self.env['liwan.feature.registry']._liwan_feature_map())

    def test_it_follows_the_registered_keys_in_both_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                platform = self.platform()
                self.assertIn(KEY, platform['readable_features'])
                self.assertIn(KEY, platform['writable_features'])
                self.assertEqual(platform['readable_features'], sorted(platform['readable_features']))
                set_probe_feature(self, enabled=False)
                self.assertNotIn(KEY, self.me()['platform']['readable_features'])
                set_probe_feature(self, enabled=False, retained=True)
                platform = self.me()['platform']
                self.assertIn(KEY, platform['readable_features'])
                self.assertNotIn(KEY, platform['writable_features'])
