# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_ai.tests.common import AiBridgeCase


@tagged('post_install', '-at_install', 'liwan')
class TestCrmAiAgent(AiBridgeCase):
    agent_key = 'crm'

    def test_the_agent_and_its_tools_follow_the_capabilities(self):
        self.assert_agent_follows_capabilities()

    def test_the_crm_policies_are_declared_for_the_setup_agent_and_apply_through_the_settings_model(self):
        registry = self.env['liwan.ai.setting.registry']
        settings = registry._liwan_ai_setting_map()
        self.assertTrue({'crm.visibility', 'crm.followup_attempts', 'crm.after_attempts', 'crm.discount_allowed'} <= set(settings))
        item = settings['crm.followup_attempts']
        with self.assertRaises(ValueError):
            registry._liwan_ai_check_value(item, 11)
        before, after = registry._liwan_ai_apply(item, registry._liwan_ai_check_value(item, 5))
        self.assertEqual((before, after), (2, 5))
        self.assertEqual(self.env['liwan.crm.settings']._liwan_effective()['followup_attempts'], 5)
