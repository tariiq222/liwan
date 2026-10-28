# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API webhook bodies and signatures used by the webhook and processing tests."""
import hashlib
import hmac
import json

from .common import APP_SECRET, PHONE_ID

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


def body_of(data):
    return json.dumps(data).encode()


def sign(raw, secret=APP_SECRET):
    return 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
