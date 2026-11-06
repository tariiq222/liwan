# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The administrator's view of the agents of the tenant's enabled applications, and the parsing of one agent's change."""
from odoo.addons.liwan_ai.models.tool_registry import TOOL_MODES
from odoo.addons.liwan_api.controllers.common import ApiError

AGENT_FLAGS = ('enabled', 'read_only', 'memory')
AGENT_PATCH_KEYS = frozenset({*AGENT_FLAGS, 'role_ids', 'tools'})


def _text(item, field):
    return {'ar': item[f'{field}_ar'], 'en': item[f'{field}_en']}


def available_agents(env):
    """``{key: (agent, [tools])}`` for the registered agents whose application the tenant has enabled.

    An agent's tools are those whose name carries its key; a platform tool (no agent) is listed with its owner's main
    agent, the one keyed by the application id, so the administrator can still set its mode.
    """
    entitlement = env['liwan.entitlement.service']
    registry = env['liwan.ai.tool.registry']
    tools = registry._liwan_ai_tool_map().values()
    agents = {}
    for key, agent in env['liwan.ai.agent.registry']._liwan_ai_agent_map().items():
        if not entitlement._liwan_feature_read(agent['feature_key']):
            continue
        main = key == agent['owner'].removeprefix('liwan_')
        agents[key] = (agent, [
            tool for tool in tools
            if registry._liwan_ai_agent_key(tool) == key or (main and tool.get('platform') and tool['owner'] == agent['owner'])
        ])
    return agents


def dump_agent_settings(env):
    settings = {row.agent_key: row for row in env['liwan.ai.agent.setting'].search([])}
    roles = env['liwan.ai.agent.setting']._liwan_ai_role_ids(settings.values())
    modes = env['liwan.ai.tool.setting']._liwan_ai_modes()
    items = []
    for key, (agent, tools) in available_agents(env).items():
        row = settings.get(key)
        items.append({
            'key': key,
            'name': _text(agent, 'name'),
            'description': _text(agent, 'description'),
            'enabled': row.enabled if row else True,
            'read_only': bool(row and row.read_only),
            'memory': agent.get('memory', True) and (not row or row.memory),
            # The administrator cannot switch memory on for an agent that declares it off.
            'memory_fixed': agent.get('memory', True) is False,
            'role_ids': sorted(roles.get(row.id, ())) if row else [],
            'revision': row.revision if row else 0,
            'tools': [
                {
                    'name': tool['name'],
                    'kind': tool['kind'],
                    'description': _text(tool, 'description'),
                    'external': bool(tool.get('external')),
                    'mode': modes.get(tool['name'], 'on'),
                }
                for tool in tools
            ],
        })
    return {'items': items, 'total': len(items)}


def _bool(payload, key):
    value = payload[key]
    if not isinstance(value, bool):
        raise ApiError(422, 'invalid', f'{key} must be a boolean', field=key)
    return value


def parse_agent_patch(payload, tools, memory_fixed=False):
    """``(changes, revision)`` of one agent's save: any of ``enabled``, ``read_only``, ``memory``, ``role_ids`` and ``tools``, and the
    revision the change was based on."""
    payload = dict(payload)
    revision = payload.pop('revision', None)
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be the revision that was read', field='revision')
    unknown = sorted(set(payload) - AGENT_PATCH_KEYS)
    if unknown:
        raise ApiError(422, 'unknown_field', f'field {unknown[0]!r} is not accepted', field=unknown[0])
    if not payload:
        raise ApiError(422, 'invalid', 'nothing to change')
    if 'memory' in payload and memory_fixed:
        raise ApiError(422, 'invalid', 'this agent never remembers', field='memory')
    changes = {key: _bool(payload, key) for key in AGENT_FLAGS if key in payload}
    if 'role_ids' in payload:
        role_ids = payload['role_ids']
        if not isinstance(role_ids, list) or not all(isinstance(rid, int) and not isinstance(rid, bool) and rid > 0 for rid in role_ids):
            raise ApiError(422, 'invalid', 'role_ids must be a list of role ids', field='role_ids')
        changes['role_ids'] = sorted(set(role_ids))
    if 'tools' in payload:
        modes = payload['tools']
        names = {tool['name'] for tool in tools}
        if not isinstance(modes, dict):
            raise ApiError(422, 'invalid', 'tools must map a tool name to its mode', field='tools')
        for name, mode in modes.items():
            if name not in names:
                raise ApiError(422, 'invalid', f'{name} is not a tool of this agent', field=f'tools.{name}')
            if mode not in TOOL_MODES:
                raise ApiError(422, 'invalid', f'mode must be one of {TOOL_MODES}', field=f'tools.{name}')
        changes['tools'] = dict(modes)
    return changes, revision
