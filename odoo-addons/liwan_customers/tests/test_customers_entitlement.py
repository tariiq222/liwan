# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``customers.enabled``: the derived key that tells the web client whether the customers routes are open."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_customers.tests.common import CustomersCase

KEY = 'customers.enabled'


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersEnabled(CustomersCase):

    def platform(self):
        self.sign_in('cu_a_staff')
        return self.me()['platform']

    def test_absent_while_no_registered_key_is_readable(self):
        set_probe_feature(self, enabled=False)
        platform = self.platform()
        self.assertNotIn(KEY, platform['readable_features'])
        self.assertNotIn(KEY, platform['writable_features'])

    def test_present_while_a_registered_key_is_readable_and_sorted(self):
        platform = self.platform()
        self.assertIn(KEY, platform['readable_features'])
        self.assertIn(KEY, platform['writable_features'])
        self.assertEqual(platform['readable_features'], sorted(platform['readable_features']))
        self.assertEqual(platform['writable_features'], sorted(platform['writable_features']))

    def test_it_is_not_a_registry_key(self):
        self.assertNotIn(KEY, self.env['liwan.feature.registry']._liwan_feature_map())

    def test_a_read_only_tenant_reads_but_does_not_write(self):
        set_probe_feature(self, enabled=False, retained=True)
        platform = self.platform()
        self.assertIn(KEY, platform['readable_features'])
        self.assertNotIn(KEY, platform['writable_features'])

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                platform = self.platform()
                self.assertIn(KEY, platform['readable_features'])
                self.assertIn(KEY, platform['writable_features'])
                set_probe_feature(self, enabled=False)
                self.assertNotIn(KEY, self.me()['platform']['readable_features'])
