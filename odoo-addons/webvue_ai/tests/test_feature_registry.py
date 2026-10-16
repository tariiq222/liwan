# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestAiFeatureRegistry(TransactionCase):

    def test_ai_features_are_registered_with_their_owner(self):
        features = self.env['webvue.feature.registry']._webvue_feature_map()
        self.assertEqual(features['ai.enabled']['type'], 'boolean')
        self.assertEqual(features['ai.enabled']['owner'], 'webvue_ai')
        self.assertEqual(features['ai.messages.monthly']['type'], 'limit')
        self.assertEqual(features['ai.tool_calls.per_run']['type'], 'limit')
        self.assertIn('webvue_ai', self.env['webvue.feature.registry']._webvue_module_map())

    def test_fresh_tenant_policy_enables_ai(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile._webvue_initialize_legacy_policy(self.env['webvue.feature.registry']._webvue_installed_module_ids())
        service = self.env['webvue.entitlement.service']
        self.assertTrue(service._webvue_feature_read('ai.enabled'))
        self.assertIsNone(service._webvue_limit_value('ai.messages.monthly'))
