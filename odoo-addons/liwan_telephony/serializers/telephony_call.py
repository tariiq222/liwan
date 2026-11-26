# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields


def _ref(record):
    return {'id': record.id, 'name': record.display_name} if record else None


def _dt(value):
    return fields.Datetime.to_string(value) if value else None


def dump_call(call):
    """The one wire shape of a call (packages/contracts/src/telephony/call.ts)."""
    return {
        'id': call.id,
        'linkedid': call.linkedid,
        'direction': call.direction,
        'state': call.state,
        'remoteNumber': call.remote_number,
        'extension': call.extension_number,
        'queue': call.queue,
        'partner': _ref(call.partner_id),
        'user': _ref(call.user_id),
        'startedAt': _dt(call.started_at),
        'answeredAt': _dt(call.answered_at),
        'endedAt': _dt(call.ended_at),
        'durationSeconds': call.duration_seconds or None,
        'recordingState': call.recording_state,
        'companyId': call.company_id.id,
    }


def dump_calls(calls):
    return [dump_call(call) for call in calls]
