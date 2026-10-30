# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_audit_receipt(row, messages_used, messages_limit):
    return {'id': row.id, 'messages_used': messages_used, 'messages_limit': messages_limit}
