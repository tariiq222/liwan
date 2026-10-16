# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_core.models.access_service import CAPABILITIES


@tagged('post_install', '-at_install', 'webvue')
class TestRegistryProbe(TransactionCase):

    def test_probe_extends_registries_without_editing_core(self):
        capabilities = self.env['webvue.access.service']._webvue_capability_map()
        self.assertIn('probe.inspect', capabilities)
        self.assertEqual(capabilities['probe.inspect']['owner'], 'webvue_registry_probe')
        self.assertTrue(set(CAPABILITIES).issubset(capabilities))
        features = self.env['webvue.feature.registry']
        self.assertIn('probe.enabled', features._webvue_feature_map())
        self.assertIn('webvue_registry_probe', features._webvue_installed_module_ids())
