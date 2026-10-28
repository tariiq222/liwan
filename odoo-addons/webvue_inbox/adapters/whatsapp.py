# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API: pure functions over `requests`, no Odoo environment.

Every call has a fixed timeout and never logs or returns the access token.
"""
import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

import requests

GRAPH_API_VERSION = 'v23.0'
GRAPH_BASE = 'https://graph.facebook.com'
TIMEOUT_SECONDS = 10
MAX_MEDIA_BYTES = 16 * 1024 * 1024
MAX_TEMPLATE_PAGES = 10
MEDIA_KINDS = frozenset({'image', 'document', 'audio', 'video', 'sticker'})
SIGNATURE_PREFIX = 'sha256='
ERROR_TEXT_LENGTH = 200


@dataclass(frozen=True)
class Credentials:
    phone_number_id: str
    business_account_id: str
    access_token: str


@dataclass(frozen=True)
class InboundMessage:
    provider_id: str
    wa_id: str
    profile_name: str | None
    sent_at: datetime
    kind: str
    body: str
    media_id: str | None
    filename: str | None


@dataclass(frozen=True)
class StatusUpdate:
    provider_id: str
    status: str
    sent_at: datetime
    error: str | None


@dataclass(frozen=True)
class Media:
    content: bytes
    mimetype: str


class ProviderError(Exception):
    """The provider refused or could not be reached; `retryable` says whether a later attempt may succeed."""

    def __init__(self, message, retryable):
        super().__init__(message)
        self.retryable = retryable


def verify_signature(app_secret, raw, header):
    """True when `header` ("sha256=<hex>") is the HMAC-SHA256 of `raw` under `app_secret`."""
    if not header or not header.startswith(SIGNATURE_PREFIX):
        return False
    expected = hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header[len(SIGNATURE_PREFIX):].encode())


def _dict(value):
    return value if isinstance(value, dict) else {}


def _dicts(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _timestamp(value):
    return datetime.fromtimestamp(int(value), timezone.utc).replace(tzinfo=None)


def _text(kind, block):
    if kind == 'text':
        return block.get('body') or ''
    if kind == 'button':
        return block.get('text') or ''
    if kind == 'interactive':
        reply = _dict(block.get('button_reply')) or _dict(block.get('list_reply'))
        return reply.get('title') or ''
    return block.get('caption') or ''


def _inbound(raw, names):
    kind = raw.get('type') or 'unknown'
    block = _dict(raw.get(kind))
    media = kind in MEDIA_KINDS
    return InboundMessage(
        provider_id=raw['id'],
        wa_id=raw['from'],
        profile_name=names.get(raw['from']),
        sent_at=_timestamp(raw['timestamp']),
        kind=kind,
        body=_text(kind, block) or f'[{kind}]',
        media_id=block.get('id') if media else None,
        filename=block.get('filename') if media else None,
    )


def _status(raw):
    errors = _dicts(raw.get('errors'))
    return StatusUpdate(
        provider_id=raw['id'],
        status=raw['status'],
        sent_at=_timestamp(raw['timestamp']),
        error=(errors[0].get('title') or errors[0].get('message')) if errors else None,
    )


def parse_events(payload, phone_number_id):
    """The inbound messages and status updates of `payload` addressed to `phone_number_id`."""
    events = []
    for entry in _dicts(payload.get('entry')):
        for change in _dicts(entry.get('changes')):
            value = _dict(change.get('value'))
            if _dict(value.get('metadata')).get('phone_number_id') != phone_number_id:
                continue
            names = {
                contact.get('wa_id'): _dict(contact.get('profile')).get('name')
                for contact in _dicts(value.get('contacts'))
            }
            events += [_inbound(raw, names) for raw in _dicts(value.get('messages'))]
            events += [_status(raw) for raw in _dicts(value.get('statuses'))]
    return events


def phone_number_ids(payload):
    """Every string metadata.phone_number_id a webhook payload addresses; other shapes are ignored."""
    ids = [
        _dict(_dict(change.get('value')).get('metadata')).get('phone_number_id')
        for entry in _dicts(payload.get('entry'))
        for change in _dicts(entry.get('changes'))
    ]
    return {value for value in ids if isinstance(value, str)}


def _error_text(response):
    try:
        message = response.json()['error']['message']
    except (ValueError, KeyError, TypeError):
        message = f'HTTP {response.status_code}'
    return str(message)[:ERROR_TEXT_LENGTH]


def _call(method, url, credentials, **kwargs):
    headers = {'Authorization': f'Bearer {credentials.access_token}'}
    try:
        response = requests.request(method, url, headers=headers, timeout=TIMEOUT_SECONDS, **kwargs)
    except requests.RequestException as error:
        raise ProviderError(f'provider unreachable: {type(error).__name__}', retryable=True) from None
    if response.status_code >= 400:
        retryable = response.status_code >= 500 or response.status_code == 429
        raise ProviderError(_error_text(response), retryable=retryable)
    return response


def _json_dict(response):
    """The JSON object of a provider response; anything else is a permanent provider error."""
    try:
        data = response.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return data


def _graph(path):
    return f'{GRAPH_BASE}/{GRAPH_API_VERSION}/{path}'


def _send(credentials, to, kind, content):
    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': kind, kind: content}
    response = _call('POST', _graph(f'{credentials.phone_number_id}/messages'), credentials, json=payload)
    messages = _json_dict(response).get('messages')
    provider_id = messages[0].get('id') if isinstance(messages, list) and messages and isinstance(messages[0], dict) else None
    if not isinstance(provider_id, str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return provider_id


def send_text(credentials, to, body):
    return _send(credentials, to, 'text', {'body': body})


def send_template(credentials, to, name, language, params):
    content = {'name': name, 'language': {'code': language}}
    if params:
        content['components'] = [{'type': 'body', 'parameters': [{'type': 'text', 'text': p} for p in params]}]
    return _send(credentials, to, 'template', content)


def fetch_media(credentials, media_id):
    meta = _json_dict(_call('GET', _graph(media_id), credentials))
    if not isinstance(meta.get('url'), str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    response = _call('GET', meta['url'], credentials, stream=True)
    content = response.raw.read(MAX_MEDIA_BYTES + 1, decode_content=True)
    if len(content) > MAX_MEDIA_BYTES:
        message = 'media is too large'
        raise ProviderError(message, retryable=False)
    return Media(content=content, mimetype=meta.get('mime_type') or 'application/octet-stream')


def _template(item):
    """One template of the provider listing with its required fields checked."""
    if not (isinstance(item.get('name'), str) and isinstance(item.get('language'), str)):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return item


def list_templates(credentials):
    """Every message template of the business account as dicts with name, language, category, status, components."""
    templates, after = [], None
    for _page in range(MAX_TEMPLATE_PAGES):
        params = {'fields': 'name,language,category,status,components', 'limit': 100}
        if after:
            params['after'] = after
        data = _json_dict(_call(
            'GET', _graph(f'{credentials.business_account_id}/message_templates'), credentials, params=params,
        ))
        templates += [_template(item) for item in _dicts(data.get('data'))]
        paging = _dict(data.get('paging'))
        after = _dict(paging.get('cursors')).get('after') if paging.get('next') else None
        if not after:
            break
    return templates


def check_phone(credentials):
    """Raise ProviderError unless the phone number id is reachable with the token."""
    _call('GET', _graph(credentials.phone_number_id), credentials, params={'fields': 'id,display_phone_number'})
