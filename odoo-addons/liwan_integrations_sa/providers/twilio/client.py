# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio REST: the one HTTP helper, the account probe and the account's numbers. Pure functions over `requests`, no ORM.

Every call authenticates with HTTP basic `AccountSid:AuthToken`. The auth token never appears in an error message.
"""
from urllib.parse import quote

import requests
from urllib3.exceptions import NewConnectionError

from odoo.addons.liwan_integrations_sa.providers import errors

API_BASE = 'https://api.twilio.com/2010-04-01'
API_HOST = 'https://api.twilio.com'
# (connect, read): a connect timeout means nothing was sent; a read timeout means the request may have been handled.
TIMEOUT_SECONDS = (5, 15)
ERROR_TEXT_LENGTH = 200
# Twilio's own error code for a suspended or closed account (https://www.twilio.com/docs/api/errors/20005).
ACCOUNT_NOT_ACTIVE = 20005
ACTIVE = 'active'
NUMBERS_PAGE_SIZE = 100
# A guard against a paging loop; an account with more numbers than this is listed partly.
NUMBERS_MAX_PAGES = 20


def account_url(account_sid, path=''):
    return f'{API_BASE}/Accounts/{quote(account_sid, safe="")}{path}.json'


def _never_sent(error):
    """Whether the request certainly did not reach Twilio: the connection was refused, timed out or the name failed.

    ``requests`` raises ``ConnectionError(err, request=request)`` from ``HTTPAdapter.send`` for a ``MaxRetryError``,
    so urllib3's ``NewConnectionError`` (its name-resolution error is a subclass) reaches the caller wrapped in
    ``args[0]`` of that ``ConnectionError``, not in ``reason``. It is raised before any byte is written.
    """
    if isinstance(error, requests.ConnectTimeout):
        return True
    if isinstance(error, NewConnectionError):
        return True
    inner = [getattr(error, 'reason', None), *error.args, error.__cause__, error.__context__]
    return any(isinstance(item, BaseException) and _never_sent(item) for item in inner)


def call(method, url, credentials, account_sid, **kwargs):
    """One authenticated request; the decoded JSON object of a 2xx answer, or `ProviderError`.

    A failure that certainly did not reach Twilio and a 429 are `retryable`; a timeout after the request was written,
    a broken connection and any 5xx are `unconfirmed`; other 4xx are final.
    """
    try:
        response = requests.request(
            method, url, auth=(account_sid, credentials['auth_token']), timeout=TIMEOUT_SECONDS, **kwargs,
        )
    except requests.RequestException as error:
        never_sent = _never_sent(error)
        raise errors.ProviderError(
            f'provider unreachable: {type(error).__name__}', retryable=never_sent, unconfirmed=not never_sent,
        ) from None
    payload = _json(response)
    if response.status_code >= 400:
        code = payload.get('code') if isinstance(payload.get('code'), int) else None
        if code == ACCOUNT_NOT_ACTIVE:
            message = 'The Twilio account is not active (suspended or closed).'
        else:
            message = str(payload.get('message') or f'HTTP {response.status_code}')[:ERROR_TEXT_LENGTH]
        status = response.status_code
        raise errors.ProviderError(message, retryable=status == 429, code=code, unconfirmed=status >= 500)
    return payload


def probe(external_id, credentials):
    """Read the account with its SID and auth token and return its friendly name; an inactive account is an error."""
    account = call('GET', account_url(external_id), credentials, external_id)
    status = account.get('status')
    if status != ACTIVE:
        raise errors.ProviderError(
            f'The Twilio account is {status if isinstance(status, str) else "not active"}.', retryable=False,
            code=ACCOUNT_NOT_ACTIVE,
        )
    name = account.get('friendly_name')
    return name if isinstance(name, str) else ''


def list_numbers(external_id, credentials):
    """``[{'value', 'label', 'sms', 'voice'}]``: the account's own phone numbers and what each can do."""
    numbers = []
    url = account_url(external_id, '/IncomingPhoneNumbers')
    params = {'PageSize': NUMBERS_PAGE_SIZE}
    for _page in range(NUMBERS_MAX_PAGES):
        page = call('GET', url, credentials, external_id, params=params)
        for item in page.get('incoming_phone_numbers') or ():
            if not isinstance(item, dict) or not isinstance(item.get('phone_number'), str):
                continue
            capabilities = item.get('capabilities') if isinstance(item.get('capabilities'), dict) else {}
            numbers.append({
                'value': item['phone_number'],
                'label': item.get('friendly_name') if isinstance(item.get('friendly_name'), str) else '',
                'sms': capabilities.get('sms') is True,
                'voice': capabilities.get('voice') is True,
            })
        next_page = page.get('next_page_uri')
        if not isinstance(next_page, str) or not next_page.startswith('/2010-04-01/'):
            break
        url, params = f'{API_HOST}{next_page}', None
    return numbers


def _json(response):
    try:
        payload = response.json()
    except ValueError:
        payload = None
    return payload if isinstance(payload, dict) else {}
