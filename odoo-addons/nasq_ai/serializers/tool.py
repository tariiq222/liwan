# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of one AI tool (master plan contract ع1). Capability and owner stay server-side."""


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
    }
