# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestAiFeatureRegistry(TransactionCase):

    def test_ai_features_are_registered_with_their_owner(self):
        features = self.env['nasq.feature.registry']._nasq_feature_map()
        self.assertEqual(features['ai.enabled']['type'], 'boolean')
        self.assertEqual(features['ai.enabled']['owner'], 'nasq_ai')
        self.assertEqual(features['ai.messages.monthly']['type'], 'limit')
        self.assertEqual(features['ai.tool_calls.per_run']['type'], 'limit')
        self.assertIn('nasq_ai', self.env['nasq.feature.registry']._nasq_module_map())

    def test_fresh_tenant_policy_enables_ai(self):
        profile = self.env.ref('nasq_platform.tenant_profile')
        profile._nasq_initialize_legacy_policy(self.env['nasq.feature.registry']._nasq_installed_module_ids())
        service = self.env['nasq.entitlement.service']
        self.assertTrue(service._nasq_feature_read('ai.enabled'))
        self.assertIsNone(service._nasq_limit_value('ai.messages.monthly'))
