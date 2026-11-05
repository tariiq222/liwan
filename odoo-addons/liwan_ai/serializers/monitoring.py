# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""This month's AI activity for the tenant administrator: counts of actions, never conversation text.

Read through the ORM as the caller, so the record rules decide which companies' rows are counted.
"""
from odoo.addons.liwan_ai.models.tool_registry import TOOL_KINDS

TOP_TOOLS = 10


def dump_monitoring(env):
    audit, usage = env['liwan.ai.audit'], env['liwan.ai.usage']
    month_start = audit._liwan_ai_month_start()
    messages = dict(audit._read_group(
        [('kind', '=', 'message'), ('create_date', '>=', month_start)], ['user_id'], ['__count'],
    ))
    tool_calls = dict(audit._read_group(
        [('kind', 'in', TOOL_KINDS), ('create_date', '>=', month_start)], ['user_id'], ['__count'],
    ))
    tokens = {
        user: (spent_in, spent_out)
        for user, spent_in, spent_out in usage._read_group(
            [('called_at', '>=', month_start)], ['user_id'], ['input_tokens:sum', 'output_tokens:sum'],
        )
    }
    users = sorted(set(messages) | set(tool_calls) | set(tokens), key=lambda user: (-messages.get(user, 0), user.id))
    tools = audit._read_group(
        [('kind', 'in', TOOL_KINDS), ('create_date', '>=', month_start)], ['tool_name'], ['__count'],
        order='__count desc, tool_name', limit=TOP_TOOLS,
    )
    user_items = [
        {
            'user': {'id': user.id, 'name': user.name},
            'messages': messages.get(user, 0),
            'tokens': sum(tokens.get(user, (0, 0))),
            'tool_calls': tool_calls.get(user, 0),
        }
        for user in users
    ]
    tool_items = [{'tool_name': name, 'calls': count} for name, count in tools]
    return {
        'month': month_start.strftime('%Y-%m'),
        'totals': {
            'messages': sum(messages.values()),
            'input_tokens': sum(spent_in for spent_in, _ in tokens.values()),
            'output_tokens': sum(spent_out for _, spent_out in tokens.values()),
            'tool_calls': sum(tool_calls.values()),
        },
        'users': {'items': user_items, 'total': len(user_items)},
        'tools': {'items': tool_items, 'total': len(tool_items)},
    }
