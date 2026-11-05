# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import (
    CREATE_CAP,
    PROBE_AGENT,
    PROBE_TOOLS,
    READ_CAP,
    WRITE_CAP,
    AiProbe,
)
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MESSAGE = {
    'conversation_id': 'r_agents_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}
EXTERNAL_TOOL = {
    **PROBE_TOOLS[1],
    'name': 'probe.send_thing',
    'external': True,
    'route': {'method': 'POST', 'path': '/api/v1/probe/things/{thing_id}/send'},
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiAgentRegistry(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()

    def _rejected(self, agents, tools, fragment):
        self.patch(type(self.env['liwan.ai.agent.registry']), '_liwan_ai_agent_definitions', lambda model: agents)
        self.patch(type(self.env['liwan.ai.tool.registry']), '_liwan_ai_tool_definitions', lambda model: tools)
        with self.assertRaises(ValidationError) as caught:
            self.env['liwan.ai.tool.registry']._liwan_ai_tool_map()
        self.assertIn(fragment, str(caught.exception))

    def test_an_agent_key_is_its_application_id(self):
        self._rejected(({**PROBE_AGENT, 'key': 'other'},), (), 'key must match owner')
        self._rejected(({**PROBE_AGENT, 'key': 'core', 'owner': 'liwan_core'},), (), 'application id')
        self._rejected(({**PROBE_AGENT, 'instructions_en': ''},), (), 'instructions_en')
        self._rejected((PROBE_AGENT, PROBE_AGENT), (), 'duplicate agent')

    def test_a_tool_without_its_agent_is_refused(self):
        self._rejected((), PROBE_TOOLS, 'registers no agent')

    def test_sensitive_fields_never_reach_a_result_summary(self):
        self._rejected((PROBE_AGENT,), ({**PROBE_TOOLS[0], 'result_summary': ['items[].partner.iban']},), 'sensitive field iban')
        self._rejected((PROBE_AGENT,), ({**PROBE_TOOLS[0], 'result_summary': ['items[].secret_note']},), 'sensitive field secret_note')

    def test_an_external_tool_must_wait_for_a_person(self):
        self._rejected((PROBE_AGENT,), ({**PROBE_TOOLS[0], 'external': True},), 'outside party')


@tagged('post_install', '-at_install', 'liwan')
class TestAiAgentSettings(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe(tools=(*PROBE_TOOLS, EXTERNAL_TOOL))
        self.granted = {READ_CAP, WRITE_CAP, CREATE_CAP}
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_agents_admin', password='ai_agents_admin_pass_123', name='Rana',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)
        self.manager.write({'group_ids': [Command.link(self.env.ref('liwan_core.group_cap_access_roles_read').id)]})
        access = type(self.env['liwan.access.service'])
        probe_check = access._liwan_has_capability

        def has_capability(model, user, key, record=None, company=None):
            if key == 'access.roles.read':
                return user == self.manager
            return probe_check(model, user, key, record=record, company=company)

        self.patch(access, '_liwan_has_capability', has_capability)

    def _catalog(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        return self.api('GET', '/api/v1/ai/tools').json()

    def _patch(self, body, key='probe', as_user=('ai_agents_admin', 'ai_agents_admin_pass_123')):
        """Save ``body`` on the current revision unless it names one."""
        self.env.invalidate_all()
        current = self.env['liwan.ai.agent.setting'].search([('agent_key', '=', key)]).revision
        self.authenticate(*as_user)
        return self.api('PATCH', f'/api/v1/ai/agents/{key}', {'revision': current or 0, **body})

    def test_a_save_from_an_older_read_is_refused(self):
        self.assertEqual(self._patch({'tools': {'probe.list_things': 'off'}}).json()['items'][0]['revision'], 1)
        stale = self._patch({'read_only': True, 'tools': {'probe.list_things': 'on'}, 'revision': 0})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        self.assertNotIn('probe.list_things', [item['name'] for item in self._catalog()['items']])
        self.assertEqual(self._patch({'color': 'red', 'revision': 'x'}).json()['field'], 'revision')

    def test_the_catalog_carries_the_agents_and_drops_external_sends_by_default(self):
        body = self._catalog()
        self.assertEqual([item['name'] for item in body['items']], ['probe.list_things', 'probe.rename_thing', 'probe.draft_thing'])
        self.assertEqual([item['requires_approval'] for item in body['items']], [False, True, True])
        self.assertEqual(body['agents'], [{
            'key': 'probe', 'name': {'ar': 'وكيل التجربة', 'en': 'Probe agent'},
            'description': {'ar': 'يجيب عن الأشياء', 'en': 'Answers about things'},
            'instructions': {'ar': 'أجب عن الأشياء فقط.', 'en': 'Answer about things only.'}, 'pages': ['things'], 'memory': True,
        }])
        self.env['liwan.ai.settings']._liwan_current().external_send = 'approve'
        self.assertIn('probe.send_thing', [item['name'] for item in self._catalog()['items']])

    def test_settings_only_narrow_the_catalog(self):
        self.assertEqual(self._patch({'tools': {'probe.list_things': 'approval', 'probe.draft_thing': 'off'}}).status_code, 200)
        body = self._catalog()
        self.assertEqual([item['name'] for item in body['items']], ['probe.list_things', 'probe.rename_thing'])
        self.assertTrue(body['items'][0]['requires_approval'])
        self._patch({'read_only': True})
        self.assertEqual([item['name'] for item in self._catalog()['items']], ['probe.list_things'])
        self._patch({'enabled': False})
        body = self._catalog()
        self.assertEqual((body['items'], body['agents']), ([], []))
        # Turning a tool on never grants a capability the user lacks.
        self._patch({'enabled': True, 'read_only': False, 'tools': {'probe.draft_thing': 'on'}})
        self.granted = {READ_CAP}
        self.assertEqual([item['name'] for item in self._catalog()['items']], ['probe.list_things'])

    def test_an_agent_limited_to_roles_hides_all_its_tools_from_others(self):
        role = self.env['liwan.access.role'].create({'key': 'ai_probe_role', 'name_ar': 'دور', 'company_id': self.env.company.id})
        self.assertEqual(self._patch({'role_ids': [role.id]}, as_user=('api_emp', 'api_emp_pass_123')).status_code, 403)
        response = self._patch({'role_ids': [role.id]})
        self.assertEqual(response.json()['items'][0]['role_ids'], [role.id])
        self.assertEqual(self._catalog()['items'], [])
        # A managed account holds what its roles grant: the employee role for ai.use, and the role the agent asks for.
        Assignment = self.env['liwan.access.assignment']
        for granted in (self.env.ref('liwan_core.role_employee'), role):
            Assignment.create({'user_id': self.employee.id, 'role_id': granted.id, 'company_id': self.env.company.id})
        self.assertEqual(len(self._catalog()['items']), 3)
        # The role cannot be deleted while it limits the agent: that would open the agent to everyone.
        Assignment.search([('role_id', '=', role.id)]).unlink()
        with self.assertRaises(ValidationError):
            role.unlink()

    def test_the_agent_routes_belong_to_the_tenant_manager(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/ai/agents').status_code, 403)
        self.assertEqual(self.api('PATCH', '/api/v1/ai/agents/probe', {'enabled': False}).status_code, 403)
        self.assertEqual(self._patch({'enabled': False}, key='nope').status_code, 404)
        for body, field in (
            ({'tools': {'probe.list_things': 'maybe'}}, 'tools.probe.list_things'),
            ({'tools': {'pmo.list_projects': 'off'}}, 'tools.pmo.list_projects'),
            ({'enabled': 'no'}, 'enabled'),
            ({'role_ids': [999999]}, 'role_ids'),
            ({'color': 'red'}, 'color'),
        ):
            response = self._patch(body)
            self.assertEqual((response.status_code, response.json().get('field')), (422, field), body)
        listing = self.api('GET', '/api/v1/ai/agents').json()
        self.assertEqual([item['key'] for item in listing['items']], ['probe'])
        self.assertEqual(listing['items'][0]['tools'][3], {
            'name': 'probe.send_thing', 'kind': 'write_light', 'description': {'ar': 'يعيد تسمية شيء', 'en': 'Rename a thing'},
            'external': True, 'mode': 'on',
        })

    def test_every_change_is_written_to_the_access_audit(self):
        self._patch({'read_only': True})
        entry = self.env['liwan.access.audit'].search([('action', '=', 'ai.agent.update')], limit=1)
        self.assertEqual((entry.before['read_only'], entry.after['read_only'], entry.actor_id), (False, True, self.manager))

    def test_a_tool_audit_names_a_known_agent(self):
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        row = {**MESSAGE, 'kind': 'read', 'tool_name': 'probe.list_things', 'result': 'ok'}
        with self.assertRaises(ValidationError):
            Audit.create({**row, 'agent': 'ghost'})
        self.assertEqual(Audit.create({**row, 'agent': 'core'}).agent_key, 'core')
        self.assertEqual(Audit.create({**row, 'agent': 'probe'}).agent_key, 'probe')
        self.authenticate('ai_agents_admin', 'ai_agents_admin_pass_123')
        agents = self.api('GET', '/api/v1/ai/monitoring').json()['agents']
        self.assertEqual(agents['items'], [{'agent': 'core', 'calls': 1}, {'agent': 'probe', 'calls': 1}])

    def test_the_per_user_monthly_cap_narrows_the_package(self):
        self.authenticate('ai_agents_admin', 'ai_agents_admin_pass_123')
        revision = self.api('GET', '/api/v1/ai/settings').json()['revision']
        changed = self.api('PATCH', '/api/v1/ai/settings', {'messages_per_user_monthly': 1, 'revision': revision}).json()
        self.assertEqual(changed['messages_per_user_monthly'], 1)
        Audit = self.env['liwan.ai.audit'].with_user(self.employee)
        Audit.create(MESSAGE)
        with self.assertRaises(LiwanAccessRule) as caught:
            Audit.create(MESSAGE)
        self.assertEqual(caught.exception.details['limit_key'], 'ai.messages.per_user_monthly')
        # Another user keeps their own count.
        self._grant_ai_use(self.manager)
        self.env['liwan.ai.audit'].with_user(self.manager).create(MESSAGE)
