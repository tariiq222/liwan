# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('liwan', 'post_install', '-at_install')
class TestCrmFeatures(TransactionCase):
    def test_features_registered_with_owner(self):
        defs = {d['key']: d for d in self.env['liwan.feature.registry']._liwan_feature_definitions()}
        for key in ('crm.enabled', 'crm.import', 'crm.export'):
            self.assertEqual(defs[key]['owner'], 'liwan_crm', key)
            self.assertEqual(defs[key]['type'], 'boolean', key)

    def test_module_is_registered(self):
        modules = {m['id'] for m in self.env['liwan.feature.registry']._liwan_module_definitions()}
        self.assertIn('liwan_crm', modules)
