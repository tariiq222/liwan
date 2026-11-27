# Part of Odoo. See LICENSE file for full copyright and licensing details.


def _ref(record):
    return {'id': record.id, 'name': record.display_name} if record else None


def _dt(value):
    """An ISO instant with `Z`, the shape the contracts and the agent both use.

    Odoo hands a `datetime` in UTC without a zone; the wire wants the `T` separator and the `Z` suffix so a client in
    any timezone reads the same instant.
    """
    if not value:
        return None
    text = str(value).replace(' ', 'T')
    if text.endswith('Z'):
        return text
    text = text.removesuffix('+00:00')
    return f'{text}Z'


def dump_call(call):
    """The one wire shape of a call (packages/contracts/src/telephony/call.ts).

    The remote number is sent as stored: E.164, or null when none could be normalized. The detail adds ``canListen``.
    """
    return {
        'id': call.id,
        'linkedid': call.linkedid,
        'direction': call.direction,
        'state': call.state,
        'remoteNumber': call.remote_number or None,
        'partner': _ref(call.partner_id),
        'user': _ref(call.user_id),
        'extension': _ref(call.extension_id) if call.extension_id else None,
        'startedAt': _dt(call.started_at),
        'answeredAt': _dt(call.answered_at),
        'endedAt': _dt(call.ended_at),
        'durationSeconds': call.duration_seconds if call.started_at and call.ended_at else None,
        'recordingState': call.recording_state,
        'companyId': call.company_id.id,
    }


def dump_calls(calls):
    return [dump_call(call) for call in calls]
