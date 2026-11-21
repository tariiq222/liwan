# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meta (WhatsApp Business account): the connection-level probe. Pure functions over `requests`, no ORM."""
from urllib.parse import quote

import requests

from . import errors

GRAPH_BASE = 'https://graph.facebook.com'
GRAPH_API_VERSION = 'v26.0'
TIMEOUT_SECONDS = 10
ERROR_TEXT_LENGTH = 200


def probe(external_id, credentials):
    """Read the business account with the access token of ``credentials`` and return its display name.

    A refusal or an unreachable Graph API raises `ProviderError`.
    """
    access_token = credentials['access_token']
    try:
        response = requests.get(
            f'{GRAPH_BASE}/{GRAPH_API_VERSION}/{quote(external_id, safe="")}', params={'fields': 'name'},
            headers={'Authorization': f'Bearer {access_token}'}, timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise errors.ProviderError(f'provider unreachable: {type(error).__name__}', retryable=True) from None
    payload = _json(response)
    if response.status_code >= 400:
        failure = payload.get('error') if isinstance(payload.get('error'), dict) else {}
        message = str(failure.get('message') or f'HTTP {response.status_code}')[:ERROR_TEXT_LENGTH]
        code = failure.get('code')
        retryable = response.status_code == 429 or response.status_code >= 500
        raise errors.ProviderError(message, retryable=retryable, code=code if isinstance(code, int) else None)
    name = payload.get('name')
    return name if isinstance(name, str) else ''


def _json(response):
    try:
        payload = response.json()
    except ValueError:
        payload = None
    return payload if isinstance(payload, dict) else {}
