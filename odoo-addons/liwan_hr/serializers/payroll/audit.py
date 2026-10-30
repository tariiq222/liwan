# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_hr.serializers.assets.common import ref


def dump_audit_event(event):
    return {
        'id': event.id,
        'action': event.action,
        'actor': ref(event.create_uid),
        'created_at': iso(event.create_date),
        'res_model': event.res_model,
        'res_id': event.res_id,
        'changes': [
            {'field': change.field_name, 'old_value': change.old_value or None, 'new_value': change.new_value or None}
            for change in event.change_ids
        ],
    }
