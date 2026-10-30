# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_core.models.access_service import CAPABILITIES


@tagged('post_install', '-at_install', 'liwan')
class TestRegistryProbe(TransactionCase):

    def test_probe_extends_registries_without_editing_core(self):
        capabilities = self.env['liwan.access.service']._liwan_capability_map()
        self.assertIn('probe.inspect', capabilities)
        self.assertEqual(capabilities['probe.inspect']['owner'], 'liwan_registry_probe')
        self.assertTrue(set(CAPABILITIES).issubset(capabilities))
        features = self.env['liwan.feature.registry']
        self.assertIn('probe.enabled', features._liwan_feature_map())
        self.assertIn('liwan_registry_probe', features._liwan_installed_module_ids())
