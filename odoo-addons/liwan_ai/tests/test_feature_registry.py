# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestAiFeatureRegistry(TransactionCase):

    def test_ai_features_are_registered_with_their_owner(self):
        features = self.env['liwan.feature.registry']._liwan_feature_map()
        self.assertEqual(features['ai.enabled']['type'], 'boolean')
        self.assertEqual(features['ai.enabled']['owner'], 'liwan_ai')
        self.assertEqual(features['ai.messages.monthly']['type'], 'limit')
        self.assertEqual(features['ai.tool_calls.per_run']['type'], 'limit')
        self.assertIn('liwan_ai', self.env['liwan.feature.registry']._liwan_module_map())

    def test_fresh_tenant_policy_enables_ai(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(self.env['liwan.feature.registry']._liwan_installed_module_ids())
        service = self.env['liwan.entitlement.service']
        self.assertTrue(service._liwan_feature_read('ai.enabled'))
        self.assertIsNone(service._liwan_limit_value('ai.messages.monthly'))
