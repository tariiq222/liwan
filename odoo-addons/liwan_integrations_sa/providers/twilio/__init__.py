# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio: one package per provider, one module per Twilio service."""
from . import client, messaging, signature, voice
from .client import list_numbers, probe
from .lookup import lookup
from .messaging import callback_message_id, list_templates, message_status, send_message
from .voice import (
    bridge_twiml,
    call_status,
    callback_call_id,
    create_call,
    recording_status,
    say_twiml,
)

__all__ = [
    'bridge_twiml',
    'call_status',
    'callback_call_id',
    'callback_message_id',
    'client',
    'create_call',
    'list_numbers',
    'list_templates',
    'lookup',
    'message_status',
    'messaging',
    'probe',
    'recording_status',
    'say_twiml',
    'send_message',
    'signature',
    'verify_callback',
    'voice',
]


def verify_callback(credentials, url, params, headers):
    """Whether a callback to ``url`` carrying ``params`` is signed by the account behind ``credentials``."""
    received = next((value for name, value in headers.items() if name.lower() == signature.HEADER.lower()), None)
    return signature.verify(credentials.get('auth_token'), url, params, received)
