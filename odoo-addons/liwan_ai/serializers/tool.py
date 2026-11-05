# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of one AI tool (master plan contract ع1) and of one agent. Capability and owner stay server-side; a
tool's agent is the prefix of its name."""


def dump_tool(item):
    return {
        'name': item['name'],
        'kind': item['kind'],
        'description': {'ar': item['description_ar'], 'en': item['description_en']},
        'input_schema': item['input_schema'],
        'route': dict(item['route']) if item.get('route') else None,
        'input_map': item.get('input_map') or {},
        'result_summary': list(item.get('result_summary') or []),
        'draft_target': item.get('draft_target'),
        # A write always waits for the user (platform constant); a read waits only in the administrator's approval mode.
        'requires_approval': item['kind'] != 'read' or item.get('mode') == 'approval',
    }


def _text(item, field):
    return {'ar': item[f'{field}_ar'], 'en': item[f'{field}_en']}


def dump_agent(item):
    """What the AI service needs to route to and run as one specialist agent."""
    return {
        'key': item['key'],
        'name': _text(item, 'name'),
        'description': _text(item, 'description'),
        'instructions': _text(item, 'instructions'),
        'pages': list(item.get('pages', ())),
    }
