# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API webhook bodies and signatures used by the webhook and processing tests."""
import hashlib
import hmac
import json

from .common import APP_SECRET, BUSINESS_ACCOUNT_ID, PHONE_ID

TIMESTAMP = 1_790_000_000


def inbound_text(provider_id='wamid.IN1', wa_id='966501112222', body='Hello', name='Sara', phone_id=PHONE_ID):
    return payload(phone_id, contacts=[{'wa_id': wa_id, 'profile': {'name': name}}], messages=[{
        'id': provider_id, 'from': wa_id, 'timestamp': str(TIMESTAMP), 'type': 'text', 'text': {'body': body},
    }])


def inbound_media(provider_id='wamid.IMG1', wa_id='966501112222', kind='image', media_id='media-1', caption=None):
    block = {'id': media_id, 'mime_type': 'image/jpeg', **({'caption': caption} if caption else {})}
    return payload(PHONE_ID, contacts=[{'wa_id': wa_id, 'profile': {'name': 'Sara'}}], messages=[{
        'id': provider_id, 'from': wa_id, 'timestamp': str(TIMESTAMP), 'type': kind, kind: block,
    }])


def inbound_message(kind, block=None, provider_id='wamid.X1', wa_id='966501112222', **extra):
    """An inbound message of any wire `kind`; `block` is the object under the kind key, `extra` top-level keys (context, ...)."""
    raw = {'id': provider_id, 'from': wa_id, 'timestamp': str(TIMESTAMP), 'type': kind, **extra}
    if block is not None:
        raw[kind] = block
    return payload(PHONE_ID, contacts=[{'wa_id': wa_id, 'profile': {'name': 'Sara'}}], messages=[raw])


def status(provider_id, state, error=None):
    item = {'id': provider_id, 'status': state, 'timestamp': str(TIMESTAMP + 60), 'recipient_id': '966501112222'}
    if error:
        item['errors'] = [{'title': error}]
    return payload(PHONE_ID, statuses=[item])


def payload(phone_id, contacts=None, messages=None, statuses=None):
    value = {'messaging_product': 'whatsapp', 'metadata': {'phone_number_id': phone_id, 'display_phone_number': '966'}}
    for key, items in (('contacts', contacts), ('messages', messages), ('statuses', statuses)):
        if items:
            value[key] = items
    return {'object': 'whatsapp_business_account', 'entry': [{'id': '1', 'changes': [{'field': 'messages', 'value': value}]}]}


def template_event(field, value, account_id=BUSINESS_ACCOUNT_ID):
    """An account-level template webhook (no phone number id): `field` is the webhook field, `value` its object."""
    return {'object': 'whatsapp_business_account', 'entry': [{'id': account_id, 'changes': [{'field': field, 'value': value}]}]}


def body_of(data):
    return json.dumps(data).encode()


def sign(raw, secret=APP_SECRET):
    return 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def flow_reply(response, provider_id='wamid.FLOWREPLY1', wa_id='966501112222', context_id=None):
    """A customer's completed form (`nfm_reply`); `response` is the answers dict, or the raw `response_json` string."""
    body = response if isinstance(response, str) else json.dumps(response)
    extra = {'context': {'from': '966', 'id': context_id}} if context_id else {}
    return inbound_message(
        'interactive', {'type': 'nfm_reply', 'nfm_reply': {'name': 'flow', 'body': 'Sent', 'response_json': body}},
        provider_id=provider_id, wa_id=wa_id, **extra,
    )


def flows_event(value, account_id=BUSINESS_ACCOUNT_ID):
    """An account-level `flows` webhook (status change, version warning, endpoint alert)."""
    return template_event('flows', value, account_id)
