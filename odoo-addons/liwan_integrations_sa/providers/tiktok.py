# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Logic ported from Chatwoot (MIT), Copyright (c) 2017-2026 Chatwoot Inc.
"""TikTok Business: the connection-level calls (authorize, token exchange, refresh, profile). Pure functions, no ORM."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import requests

from . import errors

API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'
AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize'
SCOPES = (
    'user.info.basic',
    'user.info.username',
    'user.info.stats',
    'user.info.profile',
    'user.account.type',
    'user.insights',
    'message.list.read',
    'message.list.send',
    'message.list.manage',
)
TIMEOUT_SECONDS = 10
ERROR_TEXT_LENGTH = 200


@dataclass(frozen=True)
class AppConfig:
    """The operator's own TikTok app: environment configuration, never a connection field."""
    client_key: str
    client_secret: str
    redirect_uri: str


@dataclass(frozen=True)
class Credentials:
    """One business account's token; the account's `open_id` is its identity everywhere."""
    business_id: str
    access_token: str


@dataclass(frozen=True)
class TokenGrant:
    """An OAuth answer: the access token and the refresh token that replaces it, with both deadlines."""
    open_id: str
    scopes: frozenset[str]
    access_token: str
    refresh_token: str
    expires_at: datetime
    refresh_expires_at: datetime


@dataclass(frozen=True)
class Profile:
    username: str
    display_name: str


def app_config(environ):
    """The app configuration of `environ`, or None when the operator has not set all three variables."""
    values = [
        (environ.get(key) or '').strip()
        for key in ('LIWAN_TIKTOK_CLIENT_KEY', 'LIWAN_TIKTOK_CLIENT_SECRET', 'LIWAN_TIKTOK_REDIRECT_URI')
    ]
    return AppConfig(*values) if all(values) else None


def authorize_url(config, state):
    """The TikTok account-holder authorization URL for `state`; the caller signs that state itself."""
    query = urlencode({
        'response_type': 'code',
        'client_key': config.client_key,
        'redirect_uri': config.redirect_uri,
        'scope': ','.join(SCOPES),
        'state': state,
    }, quote_via=quote)
    return f'{AUTHORIZE_URL}?{query}'


def exchange_code(config, code):
    """Exchange a single-use authorization code for the business account's first token pair."""
    return _grant(_answer(_call('POST', _api('tt_user/oauth2/token/'), json={
        'client_id': config.client_key,
        'client_secret': config.client_secret,
        'grant_type': 'authorization_code',
        'auth_code': code,
        'redirect_uri': config.redirect_uri,
    })))


def refresh_tokens(config, refresh_token):
    """Replace an access token; TikTok may rotate the refresh token, so the caller stores the answer."""
    return _grant(_answer(_call('POST', _api('tt_user/oauth2/refresh_token/'), json={
        'client_id': config.client_key,
        'client_secret': config.client_secret,
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
    })))


def business_profile(credentials):
    """The business account's own username and display name."""
    data = _answer(_call('GET', _api('business/get/'), credentials.access_token, params={
        'business_id': credentials.business_id,
        'fields': 'username,display_name,profile_image',
    }))
    return Profile(_text(data.get('username')), _text(data.get('display_name')))


def probe(external_id, access_token):
    """Read the business profile with the token and return its username."""
    return business_profile(Credentials(external_id, access_token)).username


def _api(path):
    return f'{API_BASE}/{path}'


def _call(method, url, token=None, **kwargs):
    headers = {'Access-Token': token} if token else {}
    try:
        response = requests.request(method, url, headers=headers, timeout=TIMEOUT_SECONDS, **kwargs)
    except requests.RequestException as error:
        raise errors.ProviderError(f'provider unreachable: {type(error).__name__}', retryable=True) from None
    if response.status_code >= 400:
        retryable = response.status_code == 429 or response.status_code >= 500
        raise errors.ProviderError(_error_text(response), retryable=retryable, code=_error_code(response))
    return response


def _answer(response):
    """The `data` object of a TikTok answer; a `code` other than 0 is a permanent provider error."""
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if not isinstance(payload, dict):
        message = 'malformed provider response'
        raise errors.ProviderError(message, retryable=False)
    code = payload.get('code')
    if code not in (0, '0'):
        message = _text(payload.get('message'))[:ERROR_TEXT_LENGTH] or 'provider error'
        raise errors.ProviderError(message, retryable=False, code=code if isinstance(code, (int, str)) else None)
    data = payload.get('data')
    if not isinstance(data, dict):
        message = 'malformed provider response'
        raise errors.ProviderError(message, retryable=False)
    return data


def _error_text(response):
    try:
        payload = response.json()
    except ValueError:
        payload = None
    message = _dict(payload).get('message')
    return str(message)[:ERROR_TEXT_LENGTH] if message else f'HTTP {response.status_code}'


def _error_code(response):
    try:
        payload = response.json()
    except ValueError:
        return None
    code = _dict(payload).get('code')
    return code if isinstance(code, int) and not isinstance(code, bool) else None


def _grant(data):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return TokenGrant(
        open_id=_require_text(data, 'open_id'),
        scopes=frozenset(scope for scope in _text(data.get('scope')).split(',') if scope),
        access_token=_require_text(data, 'access_token'),
        refresh_token=_require_text(data, 'refresh_token'),
        expires_at=now + timedelta(seconds=_seconds(data.get('expires_in'))),
        refresh_expires_at=now + timedelta(seconds=_seconds(data.get('refresh_token_expires_in'))),
    )


def _seconds(value):
    return int(value) if isinstance(value, (int, str)) and str(value).isdigit() else 0


def _dict(value):
    return value if isinstance(value, dict) else {}


def _text(value):
    return value if isinstance(value, str) else ''


def _require_text(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not value:
        message = 'malformed provider response'
        raise errors.ProviderError(message, retryable=False)
    return value
