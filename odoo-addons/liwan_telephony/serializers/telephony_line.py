# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

# A password is never part of any shape: Odoo holds only `has_password`, and the value itself lives in the
# company's Asterisk realtime database (design section 5).
LINE_FIELDS = (
    'name', 'kind', 'mode', 'auth_method', 'provider_host', 'provider_port', 'numbers',
    'outbound_format', 'caller_id', 'max_concurrent', 'state', 'state_detail', 'has_password',
)


def dump_line(line):
    shape = {'id': line.id}
    for name in LINE_FIELDS:
        value = getattr(line, name)
        shape[camel(name)] = fields.Datetime.to_string(value) if isinstance(value, fields.Datetime) else value
    return shape


def dump_lines(lines):
    return [dump_line(line) for line in lines]


def camel(name):
    head, *rest = name.split('_')
    return head + ''.join(part.capitalize() for part in rest)
