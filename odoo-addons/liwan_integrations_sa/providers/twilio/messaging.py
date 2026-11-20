# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Twilio Programmable Messaging: send one SMS or WhatsApp message, read a status callback, list content templates.

Pure functions over the client helper, no ORM (https://www.twilio.com/docs/messaging/api/message-resource,
https://www.twilio.com/docs/content/content-api-resources).
"""
import json

from . import client
from odoo.addons.liwan_integrations_sa.providers import errors

CONTENT_API = 'https://content.twilio.com/v1/Content'
TEMPLATES_PAGE_SIZE = 100
TEMPLATES_MAX_PAGES = 10
WHATSAPP_PREFIX = 'whatsapp:'
# The answer of a create: Twilio took the message (it is queued, sending or sent on its side), or refused it at once.
ACCEPTED_STATUSES = ('accepted', 'scheduled', 'queued', 'sending', 'sent')
REFUSED_STATUSES = ('failed', 'undelivered', 'canceled')
# How a delivery status moves a log row: only a `sent` row moves, and only forward. A status not in this table, a
# repeated one and a late one change nothing. `read` (WhatsApp) only stamps `read_at`.
STATUS_TRANSITIONS = {
    ('sent', 'delivered'): 'delivered',
    ('sent', 'undelivered'): 'undelivered',
    ('sent', 'failed'): 'failed',
}
READ_STATUS = 'read'
READ_STATES = ('sent', 'delivered')


def _address(channel, value):
    return f'{WHATSAPP_PREFIX}{value}' if channel == 'whatsapp' else value


def send_message(external_id, credentials, message):
    """Send ``message`` and return ``{'provider_message_id', 'segments', 'accepted'}``.

    ``message`` is ``{'channel', 'to', 'sender_kind', 'sender_value', 'body', 'content_sid', 'content_variables',
    'status_callback'}``. A WhatsApp message carries the ``whatsapp:`` prefix on both addresses; a messaging service
    sender is passed as ``MessagingServiceSid``. A failure is a `ProviderError` from the client helper.
    """
    channel = message['channel']
    data = {'To': _address(channel, message['to'])}
    if message['sender_kind'] == 'service':
        data['MessagingServiceSid'] = message['sender_value']
    else:
        data['From'] = _address(channel, message['sender_value'])
    if message.get('content_sid'):
        data['ContentSid'] = message['content_sid']
        if message.get('content_variables'):
            data['ContentVariables'] = json.dumps(message['content_variables'], ensure_ascii=False)
    else:
        data['Body'] = message['body']
    if message.get('status_callback'):
        data['StatusCallback'] = message['status_callback']
    answer = client.call('POST', client.account_url(external_id, '/Messages'), credentials, external_id, data=data)
    sid = answer.get('sid')
    if not isinstance(sid, str) or not sid:
        # Twilio answered 2xx without a message id: it may hold the message, so it is never sent again.
        msg = 'The provider accepted the request without a message id.'
        raise errors.ProviderError(msg, retryable=False, unconfirmed=True)
    status = answer.get('status')
    return {
        'provider_message_id': sid,
        'segments': _segments(answer.get('num_segments')),
        'accepted': status not in REFUSED_STATUSES,
        'error_code': str(answer['error_code']) if answer.get('error_code') is not None else None,
        'error_message': answer.get('error_message') if isinstance(answer.get('error_message'), str) else None,
    }


def _segments(value):
    try:
        segments = int(value)
    except (TypeError, ValueError):
        return 0
    return max(segments, 0)


def _first(params, name):
    value = params.get(name)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    return value if isinstance(value, str) else None


def callback_message_id(params):
    """The provider message id a status callback names, or None."""
    return _first(params, 'MessageSid')


def message_status(params, state, read):
    """The values a status callback writes on a row in ``state`` (``read`` says whether it is already read), or None.

    None means the callback changes nothing: a repeated, late, backward or unknown status.
    """
    status = _first(params, 'MessageStatus')
    if status == READ_STATUS:
        return {'read': True} if state in READ_STATES and not read else None
    target = STATUS_TRANSITIONS.get((state, status))
    if not target:
        return None
    values = {'state': target}
    code = _first(params, 'ErrorCode')
    if target != 'delivered' and code:
        values['error_code'] = code
    return values


def list_templates(external_id, credentials):
    """``[{'sid', 'name', 'language', 'types', 'variables'}]``: the account's content templates (Content API v1)."""
    templates = []
    url, params = CONTENT_API, {'PageSize': TEMPLATES_PAGE_SIZE}
    for _page in range(TEMPLATES_MAX_PAGES):
        page = client.call('GET', url, credentials, external_id, params=params)
        for item in page.get('contents') or ():
            if not isinstance(item, dict) or not isinstance(item.get('sid'), str):
                continue
            types = item.get('types') if isinstance(item.get('types'), dict) else {}
            variables = item.get('variables') if isinstance(item.get('variables'), dict) else {}
            templates.append({
                'sid': item['sid'],
                'name': item.get('friendly_name') if isinstance(item.get('friendly_name'), str) else '',
                'language': item.get('language') if isinstance(item.get('language'), str) else '',
                'types': sorted(str(name) for name in types),
                'variables': sorted(str(name) for name in variables),
            })
        meta = page.get('meta') if isinstance(page.get('meta'), dict) else {}
        next_url = meta.get('next_page_url')
        if not isinstance(next_url, str) or not next_url.startswith(f'{CONTENT_API}?'):
            break
        url, params = next_url, None
    return templates
