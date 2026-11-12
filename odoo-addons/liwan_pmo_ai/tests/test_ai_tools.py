# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase

PMO_TOOLS = (
    'pmo.list_my_tasks', 'pmo.list_projects', 'pmo.get_project',
    'pmo.get_project_finance_summary', 'pmo.update_task_state', 'pmo.draft_project',
)


@tagged('post_install', '-at_install', 'liwan')
class TestPmoAiTools(LiwanPmoCase):

    def test_pmo_declares_its_six_tools_over_existing_routes(self):
        tools = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()
        self.assertTrue(set(PMO_TOOLS) <= set(tools))
        routing = {
            (rule.rule, method)
            for rule in self.env['ir.http'].routing_map().iter_rules()
            for method in (rule.methods or ())
        }
        for name in PMO_TOOLS:
            tool = tools[name]
            self.assertEqual(tool['owner'], 'liwan_pmo', name)
            self.assertEqual(tool['feature_key'], 'pmo.enabled', name)
            if tool['kind'] == 'draft':
                continue
            path = tool['route']['path']
            for placeholder in ('project_id', 'task_id'):
                path = path.replace('{%s}' % placeholder, '<int:%s>' % placeholder)
            self.assertIn((path, tool['route']['method']), routing, name)

    def test_employee_sees_read_and_task_state_tools_only(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()
        names = {item['name'] for item in body['items']}
        self.assertEqual(names & set(PMO_TOOLS), {
            'pmo.list_my_tasks', 'pmo.list_projects', 'pmo.get_project',
            'pmo.get_project_finance_summary', 'pmo.update_task_state',
        })

    def test_manager_sees_the_project_draft_tool(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        body = self.api('GET', '/api/v1/ai/tools').json()
        draft = next(item for item in body['items'] if item['name'] == 'pmo.draft_project')
        self.assertEqual(draft['kind'], 'draft')
        self.assertEqual(draft['draft_target'], '/projects/new')
        self.assertEqual(draft['draft_model'], 'project.project')
        self.assertIsNone(draft['route'])
        self.assertEqual(draft['input_schema']['required'], ['name'])

    def test_list_my_tasks_tool_maps_onto_the_mine_filter(self):
        tool = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()['pmo.list_my_tasks']
        self.assertEqual(tool['input_map']['query']['filter'], 'mine')
        self.assertEqual(tool['route'], {'method': 'GET', 'path': '/api/v1/tasks'})
        self.assertIn('items[].is_overdue', tool['result_summary'])

    def test_a_user_outside_the_employee_role_sees_no_pmo_tools(self):
        new_test_user(self.env, login='api_guest', password='api_guest_pass_123', name='Ghada', groups='base.group_user')
        self.authenticate('api_guest', 'api_guest_pass_123')
        response = self.api('GET', '/api/v1/ai/tools')
        if response.status_code == 200:
            self.assertFalse({item['name'] for item in response.json()['items']} & set(PMO_TOOLS))
        else:
            self.assertEqual(response.status_code, 403)

    def test_draft_uses_core_objectives_and_success_contract(self):
        tool = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()['pmo.draft_project']
        properties = tool['input_schema']['properties']
        self.assertNotIn('charter', properties)
        self.assertIn('success_criteria', properties)
        self.assertEqual(properties['objectives']['items']['required'], ['goal'])
        self.assertEqual(set(properties['objectives']['items']['properties']), {'goal', 'metric', 'target'})

    def test_the_finance_summary_tool_keeps_its_capability_and_the_route_refuses_a_non_reader(self):
        tool = self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()['pmo.get_project_finance_summary']
        self.assertEqual(tool['capability'], 'pmo.projects.read')
        self.project.write({'company_id': self.env.company.id})
        path = tool['route']['path'].replace('{project_id}', str(self.project.id))
        # api_emp reads the project and holds one of its tasks, but the company keeps finance to the managers.
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertIn(tool['name'], {item['name'] for item in self.api('GET', '/api/v1/ai/tools').json()['items']})
        refused = self.api(tool['route']['method'], path)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api(tool['route']['method'], path).status_code, 200)
