# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.serializers.common import iso


def dump_call_state(values):
    """Whitelist the plain state the voice service returns for one row."""
    return {
        'id': values['id'],
        'mode': values['mode'],
        'origin': values['origin'],
        'state': values['state'],
        'to': values['to'],
        'from_value': values['from_value'],
        'duration_seconds': values['duration_seconds'],
        'recorded': values['recorded'],
        'error_code': values['error_code'],
        'error_message': values['error_message'],
        'created_at': iso(values['created_at']),
        'started_at': iso(values['started_at']),
        'ended_at': iso(values['ended_at']),
    }


def dump_call(call):
    """Whitelist one log row for a holder of ``integrations.log.read``; its connection and sender are named by id."""
    return {
        **dump_call_state(call._liwan_status_values()),
        'connection_id': call.connection_id.id or None,
        'sender_id': call.sender_id.id or None,
        'provider': call.provider,
        'account_ref': call.account_ref,
        'speak_text': call.speak_text or None,
        'bridge_to': call.bridge_to or None,
        'requested_by': {'id': call.requested_by.id, 'name': call.requested_by.name} if call.requested_by else None,
        'provider_call_id': call.provider_call_id or None,
        'recording_ref': call.recording_ref or None,
        'recording_duration_seconds': call.recording_duration_seconds or None,
    }
