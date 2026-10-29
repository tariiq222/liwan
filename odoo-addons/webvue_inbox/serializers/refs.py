# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The reference shape shared by every serializer of the inbox."""


def dump_ref(record):
    return {'id': record.id, 'name': record.name} if record else None
