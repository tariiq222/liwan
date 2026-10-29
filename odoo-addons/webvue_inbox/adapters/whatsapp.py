# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API: pure functions over `requests`, no Odoo environment.

Every call has a fixed timeout and never logs or returns the access token.
"""
import hashlib
import hmac
import math
import re
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
LOCATION_TEXT_LENGTH = 1000
STATUS_FIELD = 'message_template_status_update'
CATEGORY_FIELD = 'template_category_update'
QUALITY_FIELD = 'message_template_quality_update'
TEMPLATE_FIELDS = frozenset({STATUS_FIELD, CATEGORY_FIELD, QUALITY_FIELD})
NO_REASON = 'NONE'
CATALOG_ID = re.compile(r'^\d{5,32}$')
CURRENCY = re.compile(r'^[A-Z]{3}$')
MAX_RETAILER_ID = 100
MAX_ORDER_TEXT = 4096


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
class OrderItem:
    retailer_id: str
    quantity: int
    item_price: float
    currency: str


@dataclass(frozen=True)
class InboundOrder:
    """A customer's cart: the catalog it was made from, the customer's note and its lines."""
    catalog_id: str
    text: str | None
    items: tuple


@dataclass(frozen=True)
class ReferredProduct:
    """The catalog product a customer's text was sent from ("Message business" on a product)."""
    catalog_id: str
    retailer_id: str


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
    order: InboundOrder | None = None
    referred_product: ReferredProduct | None = None


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
class TemplateStatusUpdate:
    """A review or lifecycle change of a template; `event` is Meta's upper-case word (APPROVED, REJECTED, ...)."""
    template_id: str
    name: str
    language: str
    event: str
    reason: str | None


@dataclass(frozen=True)
class TemplateCategoryUpdate:
    template_id: str
    name: str
    language: str
    category: str


@dataclass(frozen=True)
class TemplateQualityUpdate:
    template_id: str
    name: str
    language: str
    score: str


TEMPLATE_UPDATES = (TemplateStatusUpdate, TemplateCategoryUpdate, TemplateQualityUpdate)


@dataclass(frozen=True)
class Media:
    content: bytes
    mimetype: str


class ProviderError(Exception):
    """The provider refused or could not be reached; `retryable` says whether a later attempt may succeed."""

    def __init__(self, message, retryable, code=None):
        super().__init__(message)
        self.retryable = retryable
        # Meta's numeric error code (for example 200: a missing permission), when the answer carried one.
        self.code = code


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


def _clip(value):
    return str(value)[:LOCATION_TEXT_LENGTH] if value else None


def _location(block):
    latitude, longitude = _number(block.get('latitude')), _number(block.get('longitude'))
    if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return Location(latitude, longitude, _clip(block.get('name')), _clip(block.get('address')))


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


def _catalog_id(value):
    text = _text(value)
    return text if text and CATALOG_ID.match(text) else None


def _retailer_id(value):
    return value if isinstance(value, str) and 0 < len(value) <= MAX_RETAILER_ID else None


def _order_item(raw):
    """One cart line, or None when a part is missing or out of range (the whole cart is then unsupported)."""
    retailer_id, quantity, currency = _retailer_id(raw.get('product_retailer_id')), raw.get('quantity'), raw.get('currency')
    price = _number(raw.get('item_price'))
    quantity_ok = isinstance(quantity, int) and not isinstance(quantity, bool) and quantity >= 1
    if not (retailer_id and quantity_ok and isinstance(currency, str) and CURRENCY.match(currency)):
        return None
    if price is None or not math.isfinite(price) or price < 0:
        return None
    return OrderItem(retailer_id, quantity, price, currency)


def _order(block):
    """The typed cart of an `order` message, or None when it is malformed."""
    catalog_id, raw_items = _catalog_id(block.get('catalog_id')), block.get('product_items')
    if not catalog_id or not isinstance(raw_items, list) or not raw_items or not all(isinstance(item, dict) for item in raw_items):
        return None
    items = tuple(_order_item(item) for item in raw_items)
    if None in items:
        return None
    text = block.get('text')
    return InboundOrder(catalog_id, text[:MAX_ORDER_TEXT] if isinstance(text, str) and text else None, items)


def _referred_product(raw):
    block = _dict(_dict(raw.get('context')).get('referred_product'))
    catalog_id, retailer_id = _catalog_id(block.get('catalog_id')), _retailer_id(block.get('product_retailer_id'))
    return ReferredProduct(catalog_id, retailer_id) if catalog_id and retailer_id else None


def _kind(wire_kind):
    if wire_kind in MEDIA_KINDS or wire_kind in TEXT_KINDS or wire_kind == 'order':
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
    order = _order(block) if kind == 'order' else None
    if kind == 'order' and not order:
        kind = 'unsupported'
    return InboundMessage(
        provider_id=raw['id'],
        wa_id=raw['from'],
        profile_name=names.get(raw['from']),
        sent_at=_timestamp(raw['timestamp']),
        kind=kind,
        body=(order.text if order else _body(kind, raw, block, location, option)) or f'[{kind}]',
        media_id=block.get('id') if media else None,
        filename=block.get('filename') if media else None,
        context_id=_dict(raw.get('context')).get('id'),
        location=location,
        option=option,
        order=order,
        referred_product=_referred_product(raw) if kind == 'text' else None,
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


def _text(value):
    return str(value) if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value) else None


def _template_reason(value):
    """Meta's reason of a status change: the `reason` word unless it is NONE, else the title of `other_info`."""
    reason = value.get('reason')
    if isinstance(reason, str) and reason and reason != NO_REASON:
        return reason[:ERROR_TEXT_LENGTH]
    info = _dict(value.get('other_info'))
    text = info.get('description') or info.get('title')
    return str(text)[:ERROR_TEXT_LENGTH] if text else None


def _template_event(field, value):
    """The typed template change of one webhook `change`, or None when it lacks the fields we need."""
    template_id = _text(value.get('message_template_id'))
    name, language = value.get('message_template_name'), value.get('message_template_language')
    if not (template_id and isinstance(name, str) and isinstance(language, str)):
        return None
    if field == STATUS_FIELD and isinstance(value.get('event'), str):
        return TemplateStatusUpdate(template_id, name, language, value['event'], _template_reason(value))
    if field == CATEGORY_FIELD and isinstance(value.get('new_category'), str):
        return TemplateCategoryUpdate(template_id, name, language, value['new_category'])
    if field == QUALITY_FIELD and isinstance(value.get('new_quality_score'), str):
        return TemplateQualityUpdate(template_id, name, language, value['new_quality_score'])
    return None


def parse_events(payload, phone_number_id, business_account_id):
    """The messages, reactions and status updates addressed to `phone_number_id` and the template changes of `business_account_id`."""
    events = []
    for entry in _dicts(payload.get('entry')):
        for change in _dicts(entry.get('changes')):
            value = _dict(change.get('value'))
            if change.get('field') in TEMPLATE_FIELDS:
                event = _template_event(change['field'], value) if entry.get('id') == business_account_id else None
                events += [event] if event else []
                continue
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


def template_business_account_ids(payload):
    """The id of every business account that a template change of the payload names (entry.id)."""
    ids = [
        entry.get('id') for entry in _dicts(payload.get('entry'))
        if any(change.get('field') in TEMPLATE_FIELDS for change in _dicts(entry.get('changes')))
    ]
    return {value for value in ids if isinstance(value, str)}


def _error_text(response):
    try:
        message = response.json()['error']['message']
    except (ValueError, KeyError, TypeError):
        message = f'HTTP {response.status_code}'
    return str(message)[:ERROR_TEXT_LENGTH]


def _error_code(response):
    try:
        code = response.json()['error']['code']
    except (ValueError, KeyError, TypeError):
        return None
    return code if isinstance(code, int) and not isinstance(code, bool) else None


def _call(method, url, credentials, timeout=TIMEOUT_SECONDS, scheme='Bearer', headers=None, **kwargs):
    headers = {'Authorization': f'{scheme} {credentials.access_token}', **(headers or {})}
    try:
        response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
    except requests.RequestException as error:
        raise ProviderError(f'provider unreachable: {type(error).__name__}', retryable=True) from None
    if response.status_code >= 400:
        retryable = response.status_code >= 500 or response.status_code == 429
        raise ProviderError(_error_text(response), retryable=retryable, code=_error_code(response))
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


def graph_request(method, path, credentials, timeout=TIMEOUT_SECONDS, **kwargs):
    """A Graph API call to `path` (below the versioned root) answered as its JSON object.

    The one entry point of other adapters over the same token-free logging and `ProviderError` mapping.
    """
    return _json_dict(_call(method, _graph(path), credentials, timeout=timeout, **kwargs))


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


def _header_parameter(header):
    """The send parameter of a template header given as {'type': text|image|video|document|location, ...}."""
    kind = header['type']
    if kind == 'text':
        return {'type': 'text', 'text': header['text']}
    if kind == 'location':
        return {'type': 'location', 'location': header['location']}
    return {'type': kind, kind: {'id': header['media_id']}}


def _button_component(button):
    """A url or copy-code button parameter given as {'index', 'sub_type': url|copy_code, 'value'}."""
    parameter = ({'type': 'coupon_code', 'coupon_code': button['value']} if button['sub_type'] == 'copy_code'
                 else {'type': 'text', 'text': button['value']})
    return {'type': 'button', 'sub_type': button['sub_type'], 'index': str(button['index']), 'parameters': [parameter]}


def send_template(credentials, to, name, language, params, header=None, buttons=()):
    content = {'name': name, 'language': {'code': language}}
    components = []
    if header:
        components.append({'type': 'header', 'parameters': [_header_parameter(header)]})
    if params:
        components.append({'type': 'body', 'parameters': [{'type': 'text', 'text': p} for p in params]})
    components += [_button_component(button) for button in buttons]
    if components:
        content['components'] = components
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


def _commerce_action(content, catalog_id):
    if content['type'] == 'product':
        return {'catalog_id': catalog_id, 'product_retailer_id': content['product_retailer_id']}
    if content['type'] == 'product_list':
        return {'catalog_id': catalog_id, 'sections': [
            {'title': section['title'], 'product_items': [{'product_retailer_id': id_} for id_ in section['product_retailer_ids']]}
            for section in content['sections']
        ]}
    thumbnail = content['thumbnail_product_retailer_id']
    return {'name': 'catalog_message', **({'parameters': {'thumbnail_product_retailer_id': thumbnail}} if thumbnail else {})}


def send_commerce(credentials, to, content, catalog_id, context_id=None):
    """Send a product, product list or catalog message given as the commerce content of the inbox contract."""
    interactive = {'type': content['type'], 'action': _commerce_action(content, catalog_id)}
    if content['body']:
        interactive['body'] = {'text': content['body']}
    if content.get('header'):
        interactive['header'] = {'type': 'text', 'text': content['header']}
    if content['footer']:
        interactive['footer'] = {'text': content['footer']}
    return _send(credentials, to, 'interactive', interactive, context_id)


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
    """Every message template of the business account as Meta lists it (id, name, language, category, status, components, quality)."""
    templates, after = [], None
    for _page in range(MAX_TEMPLATE_PAGES):
        params = {'fields': 'id,name,language,category,status,components,quality_score,rejected_reason', 'limit': 100}
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


def create_template(credentials, payload):
    """Submit a new template for review; `payload` is Meta's body (name, language, category, components). Returns Meta's {id, status, category}."""
    data = _json_dict(_call(
        'POST', _graph(f'{credentials.business_account_id}/message_templates'), credentials, json=payload,
    ))
    if not isinstance(data.get('id'), (str, int)):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return {'id': str(data['id']), 'status': data.get('status'), 'category': data.get('category')}


def edit_template(credentials, template_id, components, category=None):
    """Replace the components (and, while not approved, the category) of a template; Meta reviews it again."""
    payload = {'components': components, **({'category': category} if category else {})}
    _call('POST', _graph(template_id), credentials, json=payload)


def delete_template(credentials, template_id, name):
    """Delete one language of a template by its id and name."""
    _call(
        'DELETE', _graph(f'{credentials.business_account_id}/message_templates'), credentials,
        params={'hsm_id': template_id, 'name': name},
    )


def upload_template_sample(credentials, app_id, filename, mimetype, data):
    """Upload the sample file of a media header with the resumable upload API and return its handle."""
    session = _json_dict(_call(
        'POST', _graph(f'{app_id}/uploads'), credentials,
        params={'file_name': filename, 'file_length': len(data), 'file_type': mimetype},
    ))
    upload_id = session.get('id')
    if not isinstance(upload_id, str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    uploaded = _json_dict(_call(
        'POST', _graph(upload_id), credentials, timeout=UPLOAD_TIMEOUT_SECONDS, scheme='OAuth',
        headers={'file_offset': '0'}, data=data,
    ))
    handle = uploaded.get('h')
    if not isinstance(handle, str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return handle


def check_phone(credentials):
    """Raise ProviderError unless the phone number id is reachable with the token."""
    _call('GET', _graph(credentials.phone_number_id), credentials, params={'fields': 'id,display_phone_number'})
