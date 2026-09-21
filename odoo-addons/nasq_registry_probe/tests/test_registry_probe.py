# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_core.models.access_service import CAPABILITIES


@tagged('post_install', '-at_install', 'nasq')
class TestRegistryProbe(TransactionCase):

    def test_probe_extends_registries_without_editing_core(self):
        capabilities = self.env['nasq.access.service']._nasq_capability_map()
        self.assertIn('probe.inspect', capabilities)
        self.assertEqual(capabilities['probe.inspect']['owner'], 'nasq_registry_probe')
        self.assertTrue(set(CAPABILITIES).issubset(capabilities))
        features = self.env['nasq.feature.registry']
        self.assertIn('probe.enabled', features._nasq_feature_map())
        self.assertIn('nasq_registry_probe', features._nasq_installed_module_ids())
