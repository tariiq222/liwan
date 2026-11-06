# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.fields import Command
from odoo.http import request

from odoo.addons.liwan_ai.controllers.settings import AI_FEATURE, require_tenant_manager
from odoo.addons.liwan_ai.models.access_service import AI_SETTINGS_MANAGE
from odoo.addons.liwan_ai.serializers.agent_settings import (
    AGENT_FLAGS,
    available_agents,
    dump_agent_settings,
    parse_agent_patch,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)

ROLES_READ = 'access.roles.read'


class AiAgentsController(http.Controller):
    """The administrator's control of each agent: it can only narrow what the agent and its tools may do."""

    @http.route('/api/v1/ai/agents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(AI_FEATURE, operation='read')
    @requires_capability(AI_SETTINGS_MANAGE)
    def list_agents(self, **_):
        require_tenant_manager()
        return dump_agent_settings(request.env)

    @http.route('/api/v1/ai/agents/<string:key>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(AI_FEATURE, operation='write')
    @requires_capability(AI_SETTINGS_MANAGE)
    def update_agent(self, key, **payload):
        require_tenant_manager()
        env = request.env
        agent = available_agents(env).get(key)
        if agent is None:
            raise ApiError(404, 'not_found', 'no such agent')
        changes, revision = parse_agent_patch(payload, agent[1], memory_fixed=agent[0].get('memory', True) is False)
        before = self._snapshot(env, key)
        setting = env['liwan.ai.agent.setting'].search([('agent_key', '=', key)]) or env['liwan.ai.agent.setting'].create({'agent_key': key})
        if setting.revision != revision:
            raise ApiError(409, 'conflict', 'the agent settings changed since they were read')
        values = {field: changes[field] for field in AGENT_FLAGS if field in changes}
        values['revision'] = revision + 1
        if 'role_ids' in changes:
            # Naming roles needs the role catalog, as anywhere else in LiwanOS.
            env['liwan.access.service']._liwan_require_capability(ROLES_READ)
            roles = env['liwan.access.role'].search([('id', 'in', changes['role_ids']), ('assignable', '=', True)])
            if len(roles) != len(changes['role_ids']):
                raise ApiError(422, 'invalid', 'role_ids names an unknown role', field='role_ids')
            values['role_ids'] = [Command.set(roles.ids)]
        setting.write(values)
        ToolSetting = env['liwan.ai.tool.setting']
        for name, mode in changes.get('tools', {}).items():
            row = ToolSetting.search([('tool_name', '=', name)])
            if row:
                row.write({'mode': mode})
            else:
                ToolSetting.create({'tool_name': name, 'mode': mode})
        root = env['liwan.entitlement.service']._liwan_profile().root_company_id
        env['liwan.access.audit']._liwan_log('ai.agent.update', root, before=before, after=self._snapshot(env, key))
        return dump_agent_settings(env)

    @staticmethod
    def _snapshot(env, key):
        item = next(item for item in dump_agent_settings(env)['items'] if item['key'] == key)
        return {
            'enabled': item['enabled'], 'read_only': item['read_only'], 'memory': item['memory'], 'role_ids': item['role_ids'],
            'tools': {tool['name']: tool['mode'] for tool in item['tools']},
        }
