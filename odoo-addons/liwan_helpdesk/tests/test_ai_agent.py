# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Support agent and its read tools are declared in the registries liwan_api owns."""
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class HelpdeskAiAgentTest(TransactionCase):

    def test_the_agent_is_registered_with_its_owner_and_page(self):
        agents = self.env['liwan.ai.agent.registry']._liwan_ai_agent_definitions()
        agent = next(item for item in agents if item['key'] == 'helpdesk')
        self.assertEqual(agent['owner'], 'liwan_helpdesk')
        self.assertIn('helpdesk', agent['pages'])
        self.assertTrue(agent['name_ar'] and agent['name_en'])

    def test_every_tool_reads_a_route_with_its_own_capability(self):
        tools = [item for item in self.env['liwan.ai.tool.registry']._liwan_ai_tool_definitions()
                 if item['owner'] == 'liwan_helpdesk']
        self.assertTrue(tools)
        for tool in tools:
            self.assertEqual(tool['kind'], 'read')
            self.assertEqual(tool['capability'], 'helpdesk.tickets.read')
            self.assertEqual(tool['route']['method'], 'GET')
            self.assertTrue(tool['route']['path'].startswith('/api/v1/helpdesk/'))
            self.assertTrue(tool['result_summary'])

    def test_the_assignee_options_are_the_ones_the_ticket_api_accepts(self):
        tools = {item['name']: item for item in self.env['liwan.ai.tool.registry']._liwan_ai_tool_definitions()
                 if item['owner'] == 'liwan_helpdesk'}
        schema = tools['helpdesk.list_tickets']['input_schema']['properties']['assignee']
        self.assertEqual(schema['enum'], ['me', 'none'])
