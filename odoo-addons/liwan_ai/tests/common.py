# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Test-only tools for liwan_ai's own tests.

liwan_ai knows no application, so its tests register probe tools for the length
of one test (``self.patch`` on the registry), gated by the platform probe
feature and by capability keys the test grants through a patched
``_liwan_has_capability``. The tests behave the same with or without an
application installed.
"""
from odoo.fields import Command

from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    LiwanApiCase,
    register_probe_feature,
    set_probe_feature,
)
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

READ_CAP = 'probe.things.read'
WRITE_CAP = 'probe.things.write'
CREATE_CAP = 'probe.things.create'

PROBE_AGENT = {
    'key': 'probe',
    'owner': 'liwan_probe',
    'feature_key': PROBE_FEATURE,
    'name_ar': 'وكيل التجربة',
    'name_en': 'Probe agent',
    'description_ar': 'يجيب عن الأشياء',
    'description_en': 'Answers about things',
    'instructions_ar': 'أجب عن الأشياء فقط.',
    'instructions_en': 'Answer about things only.',
    'pages': ['things'],
    'sensitive_fields': ['secret_note'],
}

PROBE_TOOLS = (
    {
        'name': 'probe.list_things',
        'owner': 'liwan_probe',
        'kind': 'read',
        'capability': READ_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'GET', 'path': '/api/v1/probe/things'},
        'input_schema': {
            'type': 'object',
            'properties': {'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}},
            'additionalProperties': False,
        },
        'input_map': {'query': {'limit': '$limit', 'filter': 'mine'}},
        'description_ar': 'يعرض الأشياء',
        'description_en': 'List things',
        'result_summary': ['items[].id', 'items[].name', 'total'],
    },
    {
        'name': 'probe.rename_thing',
        'owner': 'liwan_probe',
        'kind': 'write_light',
        'capability': WRITE_CAP,
        'feature_key': PROBE_FEATURE,
        'route': {'method': 'PATCH', 'path': '/api/v1/probe/things/{thing_id}'},
        'input_schema': {
            'type': 'object',
            'properties': {'thing_id': {'type': 'integer'}, 'name': {'type': 'string'}},
            'required': ['thing_id', 'name'],
            'additionalProperties': False,
        },
        'input_map': {'path': {'thing_id': '$thing_id'}, 'body': {'name': '$name'}},
        'description_ar': 'يعيد تسمية شيء',
        'description_en': 'Rename a thing',
        'result_summary': ['id', 'name'],
    },
    {
        'name': 'probe.draft_thing',
        'owner': 'liwan_probe',
        'kind': 'draft',
        'capability': CREATE_CAP,
        'feature_key': PROBE_FEATURE,
        'draft_target': '/things/new',
        'input_schema': {
            'type': 'object',
            'properties': {'name': {'type': 'string'}},
            'required': ['name'],
            'additionalProperties': False,
        },
        'description_ar': 'يجهّز مسودة شيء',
        'description_en': 'Draft a thing',
    },
)


class AiProbe:
    """Mixin for TransactionCase and HttpCase classes; call ``_install_probe`` in ``setUp``.

    ``self.granted`` is the set of capability keys the patched access service
    grants to every user; tests add and remove keys to shape what a user sees.
    """

    def _grant_ai_use(self, user):
        """Give ``user`` the capability group that the ACL and record rule of ``liwan.ai.audit`` follow."""
        user.write({'group_ids': [Command.link(self.env.ref('liwan_ai.group_cap_ai_use').id)]})

    def _grant_ai_settings(self, user):
        """Make ``user`` an AI settings manager: the ACL group, and the capability for that user alone."""
        user.write({'group_ids': [Command.link(self.env.ref('liwan_ai.group_cap_ai_settings_manage').id)]})
        self.settings_managers |= user

    def _install_probe(self, tools=PROBE_TOOLS, agents=(PROBE_AGENT,)):
        self.granted = set()
        self.patch(type(self.env['liwan.ai.agent.registry']), '_liwan_ai_agent_definitions', lambda model: agents)
        self.settings_managers = self.env['res.users']
        self.branch_settings_managers = self.env['res.users']
        registry = type(self.env['liwan.ai.tool.registry'])
        self.patch(registry, '_liwan_ai_tool_definitions', lambda model: tools)
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability

        def has_capability(model, user, key, record=None, company=None):
            if key == AI_SETTINGS_MANAGE:
                # A branch manager holds the capability everywhere but in the tenant's root company.
                root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
                if user in self.branch_settings_managers:
                    return company != root
                return user in self.settings_managers
            if key in {READ_CAP, WRITE_CAP, CREATE_CAP}:
                return key in self.granted
            return original(model, user, key, record=record, company=company)

        self.patch(access, '_liwan_has_capability', has_capability)
        register_probe_feature(self)
        set_probe_feature(self)


class AiBridgeCase(LiwanApiCase):
    """The shared test of an application's AI bridge (spec 2026-11-04 §6.6): ``agent_key`` names the agent under test.

    A user without a tool's capability neither sees the tool nor runs its route; with the capability the tool appears
    under its agent. The application's feature is switched on for the test, so the check is about capabilities only.
    """
    agent_key = None

    def _bridge_tools(self):
        agent = self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().get(self.agent_key)
        self.assertTrue(agent, f'no agent {self.agent_key}')
        tools = [
            tool for tool in self.env['liwan.ai.tool.registry']._liwan_ai_tool_map().values()
            if tool['owner'] == agent['owner']
        ]
        self.assertTrue(tools, f'agent {self.agent_key} declares no tool')
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), agent['feature_key']: True},
        })
        return tools

    def _catalog_names(self):
        response = self.api('GET', '/api/v1/ai/tools')
        self.assertEqual(response.status_code, 200, response.text)
        return {item['name'] for item in response.json()['items']}

    def assert_agent_follows_capabilities(self):
        tools = self._bridge_tools()
        names = {tool['name'] for tool in tools}
        capabilities = {tool['capability'] for tool in tools}
        self.employee.write({'group_ids': [Command.link(self.env.ref('liwan_ai.group_cap_ai_use').id)]})
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability
        granted = {'value': False}

        def has_capability(model, user, key, record=None, company=None):
            if key in capabilities and user == self.employee:
                return granted['value']
            return original(model, user, key, record=record, company=company)

        self.patch(access, '_liwan_has_capability', has_capability)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertFalse(self._catalog_names() & names)
        for tool in tools:
            if tool['kind'] != 'read' or '{' in tool['route']['path']:
                continue
            constants = {key: value for key, value in (tool['input_map'].get('query') or {}).items() if not str(value).startswith('$')}
            query = '&'.join(f'{key}={value}' for key, value in constants.items())
            response = self.api('GET', tool['route']['path'] + (f'?{query}' if query else ''))
            self.assertEqual(response.status_code, 403, f"{tool['name']}: {response.text}")
        granted['value'] = True
        catalog = self.api('GET', '/api/v1/ai/tools').json()
        self.assertTrue(names <= {item['name'] for item in catalog['items']})
        self.assertIn(self.agent_key, [item['key'] for item in catalog['agents']])
