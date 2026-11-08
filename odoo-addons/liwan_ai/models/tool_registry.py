# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

TOOL_KINDS = ('read', 'write_light', 'draft')
SETUP_AGENT_KEY = 'ai'  # the setup agent of liwan_ai (models/setup_agent.py)
HELP_AGENT_KEY = 'ai_help'  # the help agent of liwan_ai (models/help_agent.py)
# The conversation modes of the free agents and the one agent each offers; an ordinary conversation offers neither.
MODE_AGENTS = {'setup': SETUP_AGENT_KEY, 'help': HELP_AGENT_KEY}
# The audit kinds of a free agent's user message (equal to its mode); they are counted against one budget, ai.assist.monthly.
ASSIST_KINDS = tuple(MODE_AGENTS)
ROUTE_METHODS = ('GET', 'POST', 'PATCH')
MAP_SECTIONS = ('path', 'query', 'body')
TOOL_NAME = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
SUMMARY_PATH = re.compile(r'^[a-z_][a-z0-9_]*(\[\])?(\.[a-z_][a-z0-9_]*(\[\])?)*$')
PLACEHOLDER = re.compile(r'\{([a-z_][a-z0-9_]*)\}')
REQUIRED_TEXT = ('owner', 'capability', 'feature_key', 'description_ar', 'description_en')
# Platform constant, the outbound data policy (spec 2026-11-04 §6.12): these fields never reach any model provider,
# whoever's provider or key it is and whatever an application declares. A result_summary path with one of these segments
# is refused when the registry loads; phase 5 refuses them as indexable sources too. The groups follow the PDPL sensitive
# categories, then the identifiers the owner blocked (identity, bank, compensation); mobile and email stay blocked here and
# the Nuxt content scan tokenizes whatever free text still carries.
SENSITIVE_FIELDS = frozenset({
    # health
    'health', 'medical', 'medical_notes', 'diagnosis', 'disease', 'illness', 'sick', 'sick_leave', 'disability',
    'blood_type', 'pregnancy', 'medication', 'allergies', 'insurance_class',
    # biometric and genetic
    'biometric', 'fingerprint', 'face_image', 'face_template', 'genetic', 'dna',
    # credit
    # (an accounting line's debit/credit amount is not credit data and stays allowed)
    'credit_score', 'credit_history', 'credit_rating', 'credit_limit', 'debt', 'loan', 'loans',
    # religion or belief, ethnic origin, unknown parentage
    'religion', 'belief', 'sect', 'ethnicity', 'ethnic_origin', 'race', 'tribe', 'parentage',
    # security and criminal
    'criminal', 'criminal_record', 'conviction', 'convictions', 'police_record', 'security_check',
    # identity numbers
    'identification_id', 'ssnid', 'passport_id', 'iqama', 'iqama_number', 'national_id', 'permit_no', 'visa_no',
    'border_number',
    # bank
    'iban', 'acc_number', 'bank_account', 'bank_account_id', 'bank_ids', 'partner_bank_id',
    # compensation
    'wage', 'salary', 'payslip', 'payslips', 'gosi', 'allowance', 'allowances', 'net_wage', 'gross_wage', 'compensation',
    # private contact data and free notes
    'private_phone', 'private_email', 'private_street', 'phone', 'mobile', 'email', 'notes', 'memo',
})
TOOL_MODES = ('on', 'approval', 'off')
# Shared input schemas for the applications' tools.
PAGE_SCHEMA = {'type': 'integer', 'minimum': 1, 'maximum': 50}
QUERY_SCHEMA = {'type': 'string', 'maxLength': 120}
DATE_SCHEMA = {'type': 'string', 'pattern': r'^\d{4}-\d{2}-\d{2}$'}
EXTERNAL_KINDS = ('write_light', 'draft')


def read_tool(owner, feature_key, name, capability, description, path, properties, query, summary):
    """The descriptor of a read tool over one GET route: ``description`` is ``(arabic, english)``, ``query`` maps the
    route's query parameters to inputs (``$name``) or constants."""
    return {
        'name': name, 'owner': owner, 'kind': 'read', 'capability': capability, 'feature_key': feature_key,
        'description_ar': description[0], 'description_en': description[1],
        'route': {'method': 'GET', 'path': path},
        'input_schema': {'type': 'object', 'properties': properties, 'additionalProperties': False},
        'input_map': {'query': query} if query else {},
        'result_summary': summary,
    }


class LiwanAiToolRegistry(models.AbstractModel):
    """LiwanOS AI tools, composed through ``super()`` like ``liwan.feature.registry``.

    liwan_ai knows no application. Each application declares its tools here:
    a name, the capability its route already checks, the route and how the
    model's inputs map onto it, and the whitelist of result fields the model
    may read. A tool outside this registry does not exist for the AI service.
    """
    _name = 'liwan.ai.tool.registry'
    _description = 'LiwanOS AI tool registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_tool_definitions(self):
        """Pure descriptors; never a process-global set."""
        return ()

    def _liwan_ai_error(self, name, message):
        raise ValidationError(self.env._('liwan_ai: tool %(name)s: %(message)s', name=name, message=message))

    @api.model
    def _liwan_ai_validate(self, item):
        name = item.get('name')
        if not isinstance(name, str) or not TOOL_NAME.match(name):
            self._liwan_ai_error(repr(name), 'name must be <app>.<verb_object>')
        for field in REQUIRED_TEXT:
            if not item.get(field) or not isinstance(item[field], str):
                self._liwan_ai_error(name, f'missing {field}')
        # The prefix is the key of the tool's agent (the AI service routes by it): the application id, or one of the
        # application's own agents (``<app>_<agent>``).
        app = item['owner'].removeprefix('liwan_')
        prefix = name.split('.')[0]
        if prefix != app and not prefix.startswith(f'{app}_'):
            self._liwan_ai_error(name, f"name prefix must match owner {item['owner']}")
        kind = item.get('kind')
        if kind not in TOOL_KINDS:
            self._liwan_ai_error(name, f'kind must be one of {TOOL_KINDS}')
        schema = item.get('input_schema')
        if not isinstance(schema, dict) or schema.get('type') != 'object' or not isinstance(schema.get('properties'), dict):
            self._liwan_ai_error(name, 'input_schema must be a JSON Schema object with properties')
        # Inputs the AI service adds itself (the knowledge candidates): mapped like an input, never offered to the model.
        service_inputs = item.get('service_inputs', ())
        if not isinstance(service_inputs, (list, tuple)) or not all(isinstance(key, str) for key in service_inputs):
            self._liwan_ai_error(name, 'service_inputs must be a list of input names')
        properties = set(schema['properties']) | set(service_inputs)
        if not isinstance(item.get('external', False), bool):
            self._liwan_ai_error(name, 'external must be a boolean')
        if not isinstance(item.get('platform', False), bool) or (item.get('platform') and kind != 'read'):
            self._liwan_ai_error(name, 'platform must be a boolean and only a read tool is a platform tool')
        setting = item.get('setting')
        if setting is not None and (
            not isinstance(setting, str) or self.env['liwan.ai.settings']._fields.get(setting) is None
            or self.env['liwan.ai.settings']._fields[setting].type != 'boolean'
        ):
            self._liwan_ai_error(name, 'setting must be a boolean field of the AI settings')
        if item.get('external') and kind not in EXTERNAL_KINDS:
            self._liwan_ai_error(name, 'a tool that reaches an outside party is a write_light or draft tool')
        if kind == 'draft':
            if item.get('route') is not None:
                self._liwan_ai_error(name, 'a draft tool has no route')
            target = item.get('draft_target')
            if not isinstance(target, str) or not target.startswith('/'):
                self._liwan_ai_error(name, 'draft_target must be an absolute page path')
            if item.get('input_map') or item.get('result_summary'):
                self._liwan_ai_error(name, 'a draft tool has no input_map or result_summary')
            return
        if item.get('draft_target') is not None:
            self._liwan_ai_error(name, 'only a draft tool has a draft_target')
        route = item.get('route')
        if not isinstance(route, dict) or route.get('method') not in ROUTE_METHODS or not str(route.get('path', '')).startswith('/api/v1/'):
            self._liwan_ai_error(name, 'route must be {method, path} under /api/v1/')
        if kind == 'read' and route['method'] == 'PATCH':
            self._liwan_ai_error(name, 'a read tool must use GET, or POST with a body')
        if kind == 'read' and route['method'] == 'POST' and 'body' not in (item.get('input_map') or {}):
            self._liwan_ai_error(name, 'a read tool that uses POST maps its inputs to the body')
        if kind == 'write_light' and route['method'] == 'GET':
            self._liwan_ai_error(name, 'a write_light tool must not use GET')
        input_map = item.get('input_map') or {}
        if not isinstance(input_map, dict) or set(input_map) - set(MAP_SECTIONS):
            self._liwan_ai_error(name, f'input_map sections must be among {MAP_SECTIONS}')
        for section, values in input_map.items():
            if not isinstance(values, dict):
                self._liwan_ai_error(name, f'input_map.{section} must be an object')
            for value in values.values():
                if isinstance(value, str) and value.startswith('$') and value[1:] not in properties:
                    self._liwan_ai_error(name, f'input_map references unknown input {value[1:]}')
        placeholders = set(PLACEHOLDER.findall(route['path']))
        unmapped = placeholders - set(input_map.get('path') or {})
        if unmapped:
            self._liwan_ai_error(name, f'path placeholder {sorted(unmapped)[0]} is not mapped')
        summary = item.get('result_summary')
        if not isinstance(summary, (list, tuple)) or not summary:
            self._liwan_ai_error(name, 'result_summary must be a non-empty list of paths')
        for path in summary:
            if not isinstance(path, str) or not SUMMARY_PATH.match(path):
                self._liwan_ai_error(name, f'result_summary path {path!r} is invalid')

    @api.model
    def _liwan_ai_blocked_fields(self):
        """Every field name no result may carry: the platform constant and each agent's own sensitive fields. The Nuxt
        executor strips these keys at any depth of a result, so a summary path that ends on a whole object cannot carry
        one either (spec 2026-11-04 §6.12, layer 1)."""
        agents = self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().values()
        return sorted(SENSITIVE_FIELDS.union(*(agent.get('sensitive_fields', ()) for agent in agents)))

    @api.model
    def _liwan_ai_check_sensitive(self, item, agent):
        """Refuse a result field that is sensitive by platform rule or by its agent's declaration."""
        sensitive = SENSITIVE_FIELDS | set(agent.get('sensitive_fields', ()))
        for path in item.get('result_summary') or ():
            hit = next((segment for segment in path.replace('[]', '').split('.') if segment in sensitive), None)
            if hit:
                self._liwan_ai_error(item['name'], f'result_summary exposes the sensitive field {hit}')

    @api.model
    def _liwan_ai_tool_map(self):
        agents = self.env['liwan.ai.agent.registry']._liwan_ai_agent_map()
        tools = {}
        for item in self._liwan_ai_tool_definitions():
            self._liwan_ai_validate(item)
            # A platform tool belongs to no agent: every conversation offers it (the knowledge search).
            agent = {} if item.get('platform') else agents.get(self._liwan_ai_agent_key(item))
            if agent is None:
                self._liwan_ai_error(item['name'], f"owner {item['owner']} registers no agent")
            if agent and agent['owner'] != item['owner']:
                # ``<app>_<agent>`` keying must not let a tool join another addon's agent.
                self._liwan_ai_error(item['name'], f"agent {agent['key']} belongs to {agent['owner']}, not to {item['owner']}")
            self._liwan_ai_check_sensitive(item, agent)
            if item['name'] in tools:
                self._liwan_ai_error(item['name'], f"duplicate tool {item['name']}")
            tools[item['name']] = item
        return tools

    @staticmethod
    def _liwan_ai_agent_key(item):
        """The agent that owns the tool (the prefix of its name), or ``None`` for a platform tool."""
        return None if item.get('platform') else item['name'].split('.')[0]

    @api.model
    def _liwan_ai_tools_for_user(self, user=None, mode=None):
        """The tools ``user`` may give the assistant, in registration order, each with its effective ``mode``.

        A setup or help conversation (``mode``) offers that free agent's tools only; an ordinary one (``mode`` ``None``)
        never offers them. A platform tool (no agent) is offered in an ordinary conversation, and a tool that declares a
        ``setting`` only while that boolean AI setting is on.

        A tool appears only when its feature reads, the user holds its capability, its agent is enabled for one of
        the user's roles, and the administrator has not turned it off; an agent set to read only keeps its read
        tools only; a tool that reaches an outside party is dropped unless the tenant lets the assistant send after
        approval. Settings only narrow: none of them can add a tool the capability check would refuse.
        """
        user = user or self.env.user
        access = self.env['liwan.access.service']
        entitlement = self.env['liwan.entitlement.service']
        agents = self.env['liwan.ai.agent.setting']._liwan_ai_effective(user)
        modes = self.env['liwan.ai.tool.setting']._liwan_ai_modes()
        ai_settings = self.env['liwan.ai.settings']._liwan_current()
        external_send = ai_settings.external_send
        mode_agent = MODE_AGENTS.get(mode)
        items = []
        for item in self._liwan_ai_tool_map().values():
            agent_key = self._liwan_ai_agent_key(item)
            offered = agent_key == mode_agent if mode_agent else agent_key not in MODE_AGENTS.values()
            if not offered:
                continue
            agent = agents.get(agent_key)
            tool_mode = modes.get(item['name'], 'on')
            if tool_mode == 'off' or (agent_key and agent is None):
                continue
            if item.get('setting') and not ai_settings[item['setting']]:
                continue
            if agent and agent['read_only'] and item['kind'] != 'read':
                continue
            if item.get('external') and item['kind'] == 'write_light' and external_send != 'approve':
                continue
            if not entitlement._liwan_feature_read(item['feature_key']) or not access._liwan_has_capability(user, item['capability']):
                continue
            items.append({**item, 'mode': tool_mode})
        return items

    @api.model
    def _liwan_ai_agents_for_user(self, tools, user=None):
        """The registered agents that own at least one of ``tools``, in registration order, each with its ``memory`` switch."""
        owners = {self._liwan_ai_agent_key(item) for item in tools} - {None}
        effective = self.env['liwan.ai.agent.setting']._liwan_ai_effective(user or self.env.user)
        return [
            {**agent, 'memory': effective[key]['memory']}
            for key, agent in self.env['liwan.ai.agent.registry']._liwan_ai_agent_map().items() if key in owners
        ]

    @api.model
    def _liwan_ai_limits(self):
        entitlement = self.env['liwan.entitlement.service']
        return {
            'tool_calls_per_run': entitlement._liwan_limit_value('ai.tool_calls.per_run'),
            'messages_monthly': entitlement._liwan_limit_value('ai.messages.monthly'),
            'messages_used': self.env['liwan.ai.audit']._liwan_ai_count_messages(),
            'assist_monthly': entitlement._liwan_limit_value('ai.assist.monthly'),
            'assist_used': self.env['liwan.ai.audit']._liwan_ai_count_messages(kinds=ASSIST_KINDS),
            'policy': self._liwan_ai_policy(),
        }

    @api.model
    def _liwan_ai_policy(self):
        """What the Nuxt server passes with every run: whose provider runs it, whether the tenant signed the current AI
        acknowledgement (no run on any provider without it, spec 2026-11-04 §6.8), and what the run may spend.

        ``input_tokens_per_run`` is the tenant's own ceiling on the input tokens of one request (issue #554), in both
        provider modes; null means no ceiling. The package's ``ai.output_tokens.per_run`` stays the platform run's cap."""
        entitlement = self.env['liwan.entitlement.service']
        settings = self.env['liwan.ai.settings']._liwan_current()
        return {
            'provider_mode': settings.provider_mode,
            'consent_signed': bool(self.env['liwan.ai.consent']._liwan_valid()),
            'tokens_monthly': entitlement._liwan_limit_value('ai.tokens.monthly'),
            'tokens_used': self.env['liwan.ai.usage']._liwan_platform_tokens_used(),
            'output_tokens_per_run': entitlement._liwan_limit_value('ai.output_tokens.per_run'),
            'input_tokens_per_run': settings.input_tokens_per_run or None,
        }
