# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

SETUP_AGENT_KEY = 'ai'  # the setup agent of liwan_ai (models/setup_agent.py)
HELP_AGENT_KEY = 'ai_help'  # the help agent of liwan_ai (models/help_agent.py)
# The conversation modes of the free agents and the one agent each offers; an ordinary conversation offers neither.
MODE_AGENTS = {'setup': SETUP_AGENT_KEY, 'help': HELP_AGENT_KEY}
# The audit kinds of a free agent's user message (equal to its mode); they are counted against one budget, ai.assist.monthly.
ASSIST_KINDS = tuple(MODE_AGENTS)
TOOL_MODES = ('on', 'approval', 'off')


class LiwanAiToolRegistry(models.AbstractModel):
    """What liwan_ai adds to the tool registry of liwan_api: which tools a user may give the assistant, and the limits
    and policy of a run."""
    _inherit = 'liwan.ai.tool.registry'

    @api.model
    def _liwan_ai_validate(self, item):
        super()._liwan_ai_validate(item)
        setting = item.get('setting')
        field = self.env['liwan.ai.settings']._fields.get(setting) if isinstance(setting, str) else None
        if setting is not None and (field is None or field.type != 'boolean'):
            self._liwan_ai_error(item['name'], 'setting must be a boolean field of the AI settings')

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
        acknowledgement (no run on any provider without it, spec 2026-11-04 §6.8), and what the run may spend: the balance,
        the free allowance and the spend ceiling.

        ``input_tokens_per_run`` is the tenant's own ceiling on the input tokens of one request (issue #554), in both
        provider modes; null means no ceiling. The package's ``ai.output_tokens.per_run`` stays the platform run's cap."""
        entitlement = self.env['liwan.entitlement.service']
        settings = self.env['liwan.ai.settings']._liwan_current()
        return {
            'provider_mode': settings.provider_mode,
            'consent_signed': bool(self.env['liwan.ai.consent']._liwan_valid()),
            'output_tokens_per_run': entitlement._liwan_limit_value('ai.output_tokens.per_run'),
            'input_tokens_per_run': settings.input_tokens_per_run or None,
            # The prepaid balance, the free allowance of the current window and the monthly spend ceiling, in cost units; null
            # means unlimited (spec 2026-11-10 §5.4). A run on the vendor's provider starts only while something is left.
            **self.env['liwan.ai.balance']._liwan_ai_policy_fields(),
        }
