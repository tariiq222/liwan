# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

AGENT_KEY = re.compile(r'^[a-z][a-z0-9_]*$')
# The platform coordinator: defined by the AI service (its instructions are platform constants), never registered here.
CORE_AGENT = 'core'
AGENT_TEXT = ('owner', 'feature_key', 'name_ar', 'name_en', 'description_ar', 'description_en', 'instructions_ar', 'instructions_en')
FIELD_NAME = re.compile(r'^[a-z_][a-z0-9_]*$')
# The page names the assistant's run context carries: a rail module id or a record scope kind (``project``).
PAGE = re.compile(r'^[a-z][a-z_-]{0,39}$')


class LiwanAiAgentRegistry(models.AbstractModel):
    """The specialist agents of the LiwanOS AI, composed through ``super()`` like ``liwan.ai.tool.registry``.

    Each application declares one agent in its ``liwan_<app>_ai`` bridge. The agent's key is the application id
    (its owner addon without ``liwan_``), the same prefix its tools carry, so an agent's tools are exactly the
    tools of its owner and no second list can drift from them (spec 2026-11-04 §6.5). An application that needs
    a second agent (``liwan_ai``: setup and help) keys it ``<app>_<agent>``, and that agent's tools carry the same prefix.
    """
    _name = 'liwan.ai.agent.registry'
    _description = 'LiwanOS AI agent registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_ai_agent_definitions(self):
        """Pure descriptors; never a process-global set."""
        return ()

    def _liwan_ai_error(self, key, message):
        raise ValidationError(self.env._('liwan_ai: agent %(key)s: %(message)s', key=key, message=message))

    @api.model
    def _liwan_ai_validate(self, item):
        key = item.get('key')
        if not isinstance(key, str) or not AGENT_KEY.match(key) or key == CORE_AGENT:
            self._liwan_ai_error(repr(key), 'key must be the application id')
        for field in AGENT_TEXT:
            if not item.get(field) or not isinstance(item[field], str):
                self._liwan_ai_error(key, f'missing {field}')
        app = item['owner'].removeprefix('liwan_')
        if key != app and not key.startswith(f'{app}_'):
            self._liwan_ai_error(key, f"key must match owner {item['owner']}")
        pages = item.get('pages', ())
        if not isinstance(pages, (list, tuple)) or not all(isinstance(page, str) and PAGE.match(page) for page in pages):
            self._liwan_ai_error(key, 'pages must be page names')
        # ``memory: False`` fixes the agent's notes off whatever the administrator stored (the help agent reads the guide only).
        if 'memory' in item and item['memory'] is not False:
            self._liwan_ai_error(key, 'memory may only be declared False')
        sensitive = item.get('sensitive_fields', ())
        if not isinstance(sensitive, (list, tuple)) or not all(isinstance(name, str) and FIELD_NAME.match(name) for name in sensitive):
            self._liwan_ai_error(key, 'sensitive_fields must be field names')

    @api.model
    def _liwan_ai_agent_map(self):
        agents = {}
        for item in self._liwan_ai_agent_definitions():
            self._liwan_ai_validate(item)
            if item['key'] in agents:
                self._liwan_ai_error(item['key'], 'duplicate agent')
            agents[item['key']] = item
        return agents
