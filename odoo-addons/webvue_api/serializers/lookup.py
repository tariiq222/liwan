# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of the country and state reference lists behind every address picker."""


def dump_lookup_items(records):
    return [{'id': record.id, 'name': record.name, 'code': record.code or ''} for record in records]
