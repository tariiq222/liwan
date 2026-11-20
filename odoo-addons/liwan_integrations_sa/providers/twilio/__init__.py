# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio: one package per provider, one module per Twilio service."""
from . import client, messaging, signature
from .client import list_numbers, probe
from .messaging import callback_message_id, list_templates, message_status, send_message

__all__ = [
    'callback_message_id', 'client', 'list_numbers', 'list_templates', 'message_status', 'messaging', 'probe',
    'send_message', 'signature', 'verify_callback',
]


def verify_callback(credentials, url, params, headers):
    """Whether a callback to ``url`` carrying ``params`` is signed by the account behind ``credentials``."""
    received = next((value for name, value in headers.items() if name.lower() == signature.HEADER.lower()), None)
    return signature.verify(credentials.get('auth_token'), url, params, received)
