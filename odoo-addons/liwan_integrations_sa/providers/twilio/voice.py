# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio Programmable Voice: place one call with inline TwiML and read its status callbacks.

Pure functions over the client helper, no ORM (https://www.twilio.com/docs/voice/api/call-resource).
The TwiML is built here from the call's own values: every value is XML-escaped, the ``<Say>`` voice is
picked per language from Twilio's list (an Arabic sentence gets an Arabic voice), and no caller-supplied
TwiML or public TwiML URL ever exists.
"""
from xml.sax.saxutils import escape

from . import client
from odoo.addons.liwan_integrations_sa.providers import errors

CALLS_PATH = '/Calls'
# The status callback events the log follows; `completed` arrives for every outcome.
CALLBACK_EVENTS = ('initiated', 'ringing', 'answered', 'completed')
RECORDING_CALLBACK_EVENT = 'completed'
# How a callback status moves a log row: only forward. `in-progress` is Twilio's spelling of the
# answered state; `completed` is the terminal row even when the call ended busy or unanswered
# (the reason travels in the terminal statuses, `CallDuration` carries the seconds).
CALL_STATUSES = ('initiated', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled', 'unconfirmed')
# A row in these states may still reach the provider: the call is on Twilio's side.
PENDING_STATES = ('initiated', 'ringing', 'in_progress', 'unconfirmed')
FINAL_STATES = ('completed', 'busy', 'no_answer', 'failed', 'canceled')
PROVIDER_TO_STATE = {
    'queued': 'initiated', 'initiated': 'initiated', 'ringing': 'ringing', 'in-progress': 'in_progress',
    'completed': 'completed', 'busy': 'busy', 'no-answer': 'no_answer', 'failed': 'failed', 'canceled': 'canceled',
}
TERMINAL_REASONS = {'busy': 'busy', 'no-answer': 'no_answer', 'failed': 'failed', 'canceled': 'canceled'}
# `<Say>` voices that speak Arabic, per language code, from Twilio's current voice list
# (https://www.twilio.com/docs/voice/twiml/say/text-speech). Polly's Zeina is Modern Standard
# Arabic; the Gulf neural voice Hala covers ar-AE.
SAY_VOICES = {
    'ar': ('Polly.Zeina', 'arb'),
    'ar-AE': ('Polly.Hala-Neural', 'ar-AE'),
}
DEFAULT_LANGUAGE = 'ar'
SPEAK_TEXT_MAX = 500


def _first(params, name):
    value = params.get(name)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    return value if isinstance(value, str) else None


def say_twiml(text, language=DEFAULT_LANGUAGE):
    """The inline TwiML that speaks ``text``: one ``<Say>`` with an explicit voice that speaks the language."""
    voice, voice_language = SAY_VOICES.get(language) or SAY_VOICES[DEFAULT_LANGUAGE]
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>'
        f'<Response><Say voice="{voice}" language="{voice_language}">{escape(text)}</Say></Response>'
    )


def bridge_twiml(customer_number):
    """The inline TwiML that reaches the called agent first, then dials the customer in when they answer."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Response>'
        f'<Dial>{escape(customer_number)}</Dial>'
        '</Response>'
    )


def create_call(external_id, credentials, call):
    """Place one call and return ``{'provider_call_id', 'status'}``.

    ``call`` is ``{'to', 'sender_value', 'twiml', 'status_callback', 'record', 'recording_status_callback'}``.
    The status callback subscribes to every call progress event, so the log follows the call from
    ``initiated`` to its end. A failure is a `ProviderError` from the client helper.
    """
    data = {'To': call['to'], 'From': call['sender_value'], 'Twiml': call['twiml']}
    if call.get('status_callback'):
        data['StatusCallback'] = call['status_callback']
        data['StatusCallbackMethod'] = 'POST'
        for event in CALLBACK_EVENTS:
            data.setdefault('StatusCallbackEvent', []).append(event)
    if call.get('record'):
        data['Record'] = 'true'
        if call.get('recording_status_callback'):
            data['RecordingStatusCallback'] = call['recording_status_callback']
            data['RecordingStatusCallbackMethod'] = 'POST'
    answer = client.call('POST', client.account_url(external_id, CALLS_PATH), credentials, external_id, data=data)
    sid = answer.get('sid')
    if not isinstance(sid, str) or not sid:
        # Twilio answered 2xx without a call id: the call may be going out, so it is never placed again.
        msg = 'The provider accepted the request without a call id.'
        raise errors.ProviderError(msg, retryable=False, unconfirmed=True)
    return {'provider_call_id': sid, 'status': PROVIDER_TO_STATE.get(answer.get('status'), 'initiated')}


def call_status(params, state):
    """The values a status callback writes on a row in ``state``, or None when it changes nothing.

    A repeated, backward or unknown status changes nothing: the table moves forward only. A terminal
    status stores the seconds the call lasted and, when the call never connected, its reason; earlier
    statuses move the state alone (`CallDuration` arrives only with them in practice).
    """
    status = _first(params, 'CallStatus')
    target = PROVIDER_TO_STATE.get(status)
    if not target:
        return None
    values = {'state': target}
    duration = _first(params, 'CallDuration')
    if status in TERMINAL_REASONS:
        values['error_code'] = TERMINAL_REASONS[status]
    if target in FINAL_STATES and duration and duration.isdigit():
        values['duration_seconds'] = int(duration)
    if state in FINAL_STATES or state == target:
        return None
    return values


def recording_status(params, state):
    """The recording reference a ``recording-status`` callback stores on a row, or None.

    Only the SID and the seconds are kept (D7): no audio is fetched. A callback for a recording
    Twilio reports ``absent`` leaves nothing to store.
    """
    if state not in FINAL_STATES:
        return None
    sid = _first(params, 'RecordingSid')
    if not sid:
        return None
    values = {'recorded': True, 'recording_ref': sid}
    duration = _first(params, 'RecordingDuration')
    if duration and duration.isdigit():
        values['recording_duration_seconds'] = int(duration)
    return values


def callback_call_id(params):
    """The provider call id a status callback names, or None."""
    return _first(params, 'CallSid')
