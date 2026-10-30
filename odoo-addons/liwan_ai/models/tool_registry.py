# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models
from odoo.exceptions import ValidationError

TOOL_KINDS = ('read', 'write_light', 'draft')
ROUTE_METHODS = ('GET', 'POST', 'PATCH')
MAP_SECTIONS = ('path', 'query', 'body')
TOOL_NAME = re.compile(r'^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
SUMMARY_PATH = re.compile(r'^[a-z_][a-z0-9_]*(\[\])?(\.[a-z_][a-z0-9_]*(\[\])?)*$')
PLACEHOLDER = re.compile(r'\{([a-z_][a-z0-9_]*)\}')
REQUIRED_TEXT = ('owner', 'capability', 'feature_key', 'description_ar', 'description_en')


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
        if name.split('.')[0] != item['owner'].removeprefix('liwan_'):
            self._liwan_ai_error(name, f"name prefix must match owner {item['owner']}")
        kind = item.get('kind')
        if kind not in TOOL_KINDS:
            self._liwan_ai_error(name, f'kind must be one of {TOOL_KINDS}')
        schema = item.get('input_schema')
        if not isinstance(schema, dict) or schema.get('type') != 'object' or not isinstance(schema.get('properties'), dict):
            self._liwan_ai_error(name, 'input_schema must be a JSON Schema object with properties')
        properties = set(schema['properties'])
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
        if kind == 'read' and route['method'] != 'GET':
            self._liwan_ai_error(name, 'a read tool must use GET')
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
    def _liwan_ai_tool_map(self):
        tools = {}
        for item in self._liwan_ai_tool_definitions():
            self._liwan_ai_validate(item)
            if item['name'] in tools:
                self._liwan_ai_error(item['name'], f"duplicate tool {item['name']}")
            tools[item['name']] = item
        return tools

    @api.model
    def _liwan_ai_feature_keys(self):
        """Feature keys of the registered tools, in registration order, each once."""
        keys = []
        for item in self._liwan_ai_tool_map().values():
            if item['feature_key'] not in keys:
                keys.append(item['feature_key'])
        return tuple(keys)

    @api.model
    def _liwan_ai_tools_for_user(self, user=None):
        """The registered tools whose feature reads and whose capability ``user`` holds, in registration order."""
        user = user or self.env.user
        access = self.env['liwan.access.service']
        entitlement = self.env['liwan.entitlement.service']
        return [
            item for item in self._liwan_ai_tool_map().values()
            if entitlement._liwan_feature_read(item['feature_key'])
            and access._liwan_has_capability(user, item['capability'])
        ]

    @api.model
    def _liwan_ai_limits(self):
        entitlement = self.env['liwan.entitlement.service']
        return {
            'tool_calls_per_run': entitlement._liwan_limit_value('ai.tool_calls.per_run'),
            'messages_monthly': entitlement._liwan_limit_value('ai.messages.monthly'),
            'messages_used': self.env['liwan.ai.audit']._liwan_ai_count_messages(),
        }
