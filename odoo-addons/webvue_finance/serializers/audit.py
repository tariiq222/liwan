# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.serializers.common import iso


def dump_audit_event(event):
    return {
        'id': event.id,
        'action': event.action,
        'actor': {'id': event.create_uid.id, 'name': event.create_uid.name},
        'created_at': iso(event.create_date),
        'res_model': event.res_model,
        'res_id': event.res_id,
        'fields_written': event.fields_written.split(', ') if event.fields_written else [],
        'outcome': event.outcome or None,
    }


def dump_audit_events(events):
    return [dump_audit_event(event) for event in events]
