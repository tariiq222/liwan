# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API: pure functions over `requests`, no Odoo environment.

Every call has a fixed timeout and never logs or returns the access token.
"""
import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

import requests
import urllib3

GRAPH_API_VERSION = 'v23.0'
GRAPH_BASE = 'https://graph.facebook.com'
TIMEOUT_SECONDS = 10
UPLOAD_TIMEOUT_SECONDS = 60
TYPING_TIMEOUT_SECONDS = 3
MAX_MEDIA_BYTES = 16 * 1024 * 1024
MAX_TEMPLATE_PAGES = 10
MEDIA_KINDS = frozenset({'image', 'document', 'audio', 'video', 'sticker'})
TEXT_KINDS = frozenset({'text', 'location', 'contacts'})
# A WhatsApp message type that is not stored as itself: the customer's answer to an interactive message or template.
REPLY_TYPES = frozenset({'interactive', 'button'})
SIGNATURE_PREFIX = 'sha256='
ERROR_TEXT_LENGTH = 200


@dataclass(frozen=True)
class Credentials:
    phone_number_id: str
    business_account_id: str
    access_token: str


@dataclass(frozen=True)
class Location:
    latitude: float
    longitude: float
    name: str | None
    address: str | None


@dataclass(frozen=True)
class Option:
    id: str
    title: str


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
    context_id: str | None
    location: Location | None
    option: Option | None


@dataclass(frozen=True)
class InboundReaction:
    """The customer's reaction to the message `target_id`; an empty `emoji` removes it."""
    wa_id: str
    target_id: str
    emoji: str


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


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _location(block):
    latitude, longitude = _number(block.get('latitude')), _number(block.get('longitude'))
    if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return Location(latitude, longitude, block.get('name') or None, block.get('address') or None)


def _contacts_text(raw):
    """One readable line per shared contact: the name and its phone numbers."""
    lines = []
    for contact in _dicts(raw.get('contacts')):
        name = _dict(contact.get('name')).get('formatted_name') or ''
        phones = [phone.get('phone') for phone in _dicts(contact.get('phones')) if phone.get('phone')]
        lines.append(': '.join(part for part in (name, ', '.join(phones)) if part))
    return '\n'.join(line for line in lines if line)


def _option(kind, block):
    """The option a customer chose: a template quick-reply button or an interactive reply."""
    if kind == 'button':
        text = block.get('text') or ''
        return Option(block.get('payload') or text, text)
    reply = _dict(block.get('button_reply')) or _dict(block.get('list_reply'))
    return Option(str(reply.get('id') or ''), reply.get('title') or '') if reply else None


def _kind(wire_kind):
    if wire_kind in MEDIA_KINDS or wire_kind in TEXT_KINDS:
        return wire_kind
    return 'interactive' if wire_kind in REPLY_TYPES else 'unsupported'


def _body(kind, raw, block, location, option):
    if kind == 'text':
        return block.get('body') or ''
    if kind == 'contacts':
        return _contacts_text(raw)
    if kind == 'location':
        return (location.name or location.address or f'{location.latitude:.6f}, {location.longitude:.6f}') if location else ''
    if kind == 'interactive':
        return option.title if option else ''
    return block.get('caption') or ''


def _inbound(raw, names):
    wire_kind = raw.get('type') or 'unknown'
    block = _dict(raw.get(wire_kind))
    kind = _kind(wire_kind)
    media = kind in MEDIA_KINDS
    location = _location(block) if kind == 'location' else None
    option = _option(wire_kind, block) if kind == 'interactive' else None
    if kind == 'location' and not location:
        kind = 'unsupported'
    return InboundMessage(
        provider_id=raw['id'],
        wa_id=raw['from'],
        profile_name=names.get(raw['from']),
        sent_at=_timestamp(raw['timestamp']),
        kind=kind,
        body=_body(kind, raw, block, location, option) or f'[{kind}]',
        media_id=block.get('id') if media else None,
        filename=block.get('filename') if media else None,
        context_id=_dict(raw.get('context')).get('id'),
        location=location,
        option=option,
    )


def _reaction(raw):
    block = _dict(raw.get('reaction'))
    target = block.get('message_id')
    return InboundReaction(raw['from'], target, block.get('emoji') or '') if isinstance(target, str) else None


def _message_event(raw, names):
    return _reaction(raw) if raw.get('type') == 'reaction' else _inbound(raw, names)


def _status(raw):
    errors = _dicts(raw.get('errors'))
    return StatusUpdate(
        provider_id=raw['id'],
        status=raw['status'],
        sent_at=_timestamp(raw['timestamp']),
        error=(errors[0].get('title') or errors[0].get('message')) if errors else None,
    )


def parse_events(payload, phone_number_id):
    """The inbound messages, reactions and status updates of `payload` addressed to `phone_number_id`."""
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
            events += [event for event in (_message_event(raw, names) for raw in _dicts(value.get('messages'))) if event]
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


def _call(method, url, credentials, timeout=TIMEOUT_SECONDS, **kwargs):
    headers = {'Authorization': f'Bearer {credentials.access_token}'}
    try:
        response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
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


def _send(credentials, to, kind, content, context_id=None):
    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': kind, kind: content}
    if context_id:
        payload['context'] = {'message_id': context_id}
    response = _call('POST', _graph(f'{credentials.phone_number_id}/messages'), credentials, json=payload)
    messages = _json_dict(response).get('messages')
    provider_id = messages[0].get('id') if isinstance(messages, list) and messages and isinstance(messages[0], dict) else None
    if not isinstance(provider_id, str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return provider_id


def send_text(credentials, to, body, context_id=None):
    return _send(credentials, to, 'text', {'body': body}, context_id)


def send_template(credentials, to, name, language, params):
    content = {'name': name, 'language': {'code': language}}
    if params:
        content['components'] = [{'type': 'body', 'parameters': [{'type': 'text', 'text': p} for p in params]}]
    return _send(credentials, to, 'template', content)


def upload_media(credentials, filename, mimetype, data):
    """Upload a file to the business phone number and return its media id."""
    response = _call(
        'POST', _graph(f'{credentials.phone_number_id}/media'), credentials, timeout=UPLOAD_TIMEOUT_SECONDS,
        data={'messaging_product': 'whatsapp', 'type': mimetype}, files={'file': (filename, data, mimetype)},
    )
    media_id = _json_dict(response).get('id')
    if not isinstance(media_id, str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return media_id


def send_media(credentials, to, kind, media_id, caption=None, filename=None, context_id=None):
    """Send an uploaded file; audio takes no caption and only a document shows a filename."""
    content = {'id': media_id}
    if caption:
        content['caption'] = caption
    if kind == 'document' and filename:
        content['filename'] = filename
    return _send(credentials, to, kind, content, context_id)


def send_location(credentials, to, location, context_id=None):
    content = {'latitude': location.latitude, 'longitude': location.longitude}
    content.update({key: value for key, value in (('name', location.name), ('address', location.address)) if value})
    return _send(credentials, to, 'location', content, context_id)


def _interactive_action(interactive):
    if interactive['type'] == 'buttons':
        return {'buttons': [{'type': 'reply', 'reply': button} for button in interactive['buttons']]}
    if interactive['type'] == 'list':
        sections = [
            {**({'title': section['title']} if section['title'] else {}), 'rows': [
                {key: value for key, value in row.items() if value is not None} for row in section['rows']
            ]}
            for section in interactive['sections']
        ]
        return {'button': interactive['button'], 'sections': sections}
    return {'name': 'cta_url', 'parameters': {'display_text': interactive['display_text'], 'url': interactive['url']}}


def send_interactive(credentials, to, interactive, context_id=None):
    """Send an interactive message given as the wire shape of the inbox contract (buttons, list or cta_url)."""
    content = {
        'type': 'button' if interactive['type'] == 'buttons' else interactive['type'],
        'body': {'text': interactive['body']},
        'action': _interactive_action(interactive),
    }
    if interactive['header']:
        content['header'] = {'type': 'text', 'text': interactive['header']}
    if interactive['footer']:
        content['footer'] = {'text': interactive['footer']}
    return _send(credentials, to, 'interactive', content, context_id)


def send_reaction(credentials, to, message_id, emoji):
    """React to a message with `emoji`; an empty emoji removes the reaction."""
    return _send(credentials, to, 'reaction', {'message_id': message_id, 'emoji': emoji})


def mark_read(credentials, message_id, typing=False):
    """Mark an inbound message read; with `typing` also show the typing indicator to the customer for a short while."""
    payload = {'messaging_product': 'whatsapp', 'status': 'read', 'message_id': message_id}
    if typing:
        payload['typing_indicator'] = {'type': 'text'}
    _call(
        'POST', _graph(f'{credentials.phone_number_id}/messages'), credentials, json=payload,
        timeout=TYPING_TIMEOUT_SECONDS if typing else TIMEOUT_SECONDS,
    )


def fetch_media(credentials, media_id):
    meta = _json_dict(_call('GET', _graph(media_id), credentials))
    if not isinstance(meta.get('url'), str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    response = _call('GET', meta['url'], credentials, stream=True)
    try:
        content = response.raw.read(MAX_MEDIA_BYTES + 1, decode_content=True)
    except (requests.RequestException, urllib3.exceptions.HTTPError, OSError) as error:
        message = f'media download failed: {type(error).__name__}'
        raise ProviderError(message, retryable=True) from None
    finally:
        response.close()
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
