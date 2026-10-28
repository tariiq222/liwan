# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('webvue', 'post_install', '-at_install')
class TestCrmFeatures(TransactionCase):
    def test_features_registered_with_owner(self):
        defs = {d['key']: d for d in self.env['webvue.feature.registry']._webvue_feature_definitions()}
        for key in ('crm.enabled', 'crm.import', 'crm.export'):
            self.assertEqual(defs[key]['owner'], 'webvue_crm', key)
            self.assertEqual(defs[key]['type'], 'boolean', key)

    def test_module_is_registered(self):
        modules = {m['id'] for m in self.env['webvue.feature.registry']._webvue_module_definitions()}
        self.assertIn('webvue_crm', modules)
