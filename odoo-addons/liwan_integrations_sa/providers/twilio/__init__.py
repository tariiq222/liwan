# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio: one package per provider, one module per Twilio service."""
from . import client, signature
from .client import list_numbers, probe

__all__ = ['client', 'list_numbers', 'probe', 'signature', 'verify_callback']


def verify_callback(credentials, url, params, headers):
    """Whether a callback to ``url`` carrying ``params`` is signed by the account behind ``credentials``."""
    received = next((value for name, value in headers.items() if name.lower() == signature.HEADER.lower()), None)
    return signature.verify(credentials.get('auth_token'), url, params, received)
