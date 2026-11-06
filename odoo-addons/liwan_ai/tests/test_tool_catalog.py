# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo.tests import TransactionCase, tagged

CONVERTER = re.compile(r'<(?:[a-z]+:)?([a-z_][a-z0-9_]*)>')
PLACEHOLDER = re.compile(r'\{([a-z_][a-z0-9_]*)\}')


@tagged('post_install', '-at_install', 'liwan')
class TestAiToolCatalog(TransactionCase):
    """The CI check of every installed tool (spec 2026-11-04 §6.6): the registries load (names, agents, sensitive
    fields), every capability is registered, every feature is registered and every route exists with its method."""

    def test_every_installed_tool_is_backed_by_a_route_a_capability_and_a_feature(self):
        tools = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()
        capabilities = set(self.env['liwan.access.service']._liwan_capability_map())
        features = self.env['liwan.feature.registry']._liwan_feature_map()
        routes = {
            (CONVERTER.sub(r'{\1}', rule.rule), method)
            for rule in self.env['ir.http'].routing_map().iter_rules()
            for method in (rule.methods or ())
        }
        for name, tool in tools.items():
            self.assertIn(tool['capability'], capabilities, f'{name}: unregistered capability')
            self.assertIn(tool['feature_key'], features, f'{name}: unregistered feature')
            if tool['kind'] == 'draft':
                continue
            path = PLACEHOLDER.sub(r'{\1}', tool['route']['path'])
            self.assertIn((path, tool['route']['method']), routes, f'{name}: no such route')

    def test_every_agent_belongs_to_a_registered_feature(self):
        features = self.env['liwan.feature.registry']._liwan_feature_map()
        for key, agent in self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().items():
            self.assertIn(agent['feature_key'], features, key)

    def test_every_readiness_check_is_backed_by_a_capability_a_feature_and_a_model(self):
        capabilities = set(self.env['liwan.access.service']._liwan_capability_map())
        features = self.env['liwan.feature.registry']._liwan_feature_map()
        for key, check in self.env['liwan.ai.readiness']._liwan_ai_check_map().items():
            self.assertIn(check['capability'], capabilities, f'{key}: unregistered capability')
            self.assertIn(check['feature_key'], features, f'{key}: unregistered feature')
            self.assertIn(check['model'], self.env, f'{key}: no such model')
