# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import AiAgentCase


@tagged('post_install', '-at_install', 'liwan')
class TestTasksAiAgent(AiAgentCase):
    agent_key = 'tasks'

    def test_the_agent_and_its_tools_follow_the_capabilities(self):
        self.assert_agent_follows_capabilities()
