# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_ai.tests.common import AiBridgeCase


@tagged('post_install', '-at_install', 'liwan')
class TestHrAiAgent(AiBridgeCase):
    agent_key = 'hr'

    def test_the_agent_and_its_tools_follow_the_capabilities(self):
        self.assert_agent_follows_capabilities()

        response = self.api('GET', '/api/v1/ai/tools')
        self.assertEqual(response.status_code, 200, response.text)
        hr_tools = [
            (tool['name'], tool['route'], tool['result_summary'])
            for tool in response.json()['items']
            if tool['name'].startswith('hr.')
            or (tool['route'] or {}).get('path', '').startswith('/api/v1/hr/')
        ]
        self.assertEqual(hr_tools, [(
            'hr.get_my_profile',
            {'method': 'GET', 'path': '/api/v1/hr/me'},
            ['id', 'name', 'job_title', 'department.name', 'manager.name'],
        )])
