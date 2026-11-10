# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

AI_BALANCE_KEYS = ('ai.balance.granted', 'ai.allowance.trial', 'ai.allowance.monthly')


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

    def test_derived_balance_keys_are_registered_limits_the_control_plane_can_deliver(self):
        """The shared-tenant effect writes these three keys with every delivery; an unregistered key is refused."""
        registry = self.env['liwan.feature.registry']._liwan_feature_map()
        service = self.env['liwan.entitlement.service']
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile._liwan_initialize_legacy_policy(self.env['liwan.feature.registry']._liwan_installed_module_ids())
        for key in AI_BALANCE_KEYS:
            self.assertEqual(registry[key]['type'], 'limit', key)
            self.assertEqual(registry[key]['owner'], 'liwan_ai', key)
            # Nothing counts them as usage, so the observation needs no counter for them.
            self.assertEqual(service._liwan_count_usage(key), 0, key)
        delivered = {'ai.balance.granted': 666666, 'ai.allowance.trial': 133333, 'ai.allowance.monthly': 0}
        features = service._liwan_close_unlisted_features({**profile.features, **delivered})
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})
        self.assertEqual({key: profile.features[key] for key in AI_BALANCE_KEYS}, delivered)
        self.assertEqual(service._liwan_limit_value('ai.balance.granted'), 666666)
        # A registered key a plan never lists closes to 0, never to unlimited.
        closed = service._liwan_close_unlisted_features({key: value for key, value in profile.features.items() if key not in AI_BALANCE_KEYS})
        self.assertEqual({key: closed[key] for key in AI_BALANCE_KEYS}, dict.fromkeys(AI_BALANCE_KEYS, 0))
