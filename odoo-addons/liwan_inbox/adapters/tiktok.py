# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Logic ported from Chatwoot (MIT), Copyright (c) 2017-2026 Chatwoot Inc.
"""TikTok Business Messaging API: pure functions over `requests`, no Odoo environment."""
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import requests

from odoo.addons.liwan_inbox.adapters import errors, media_download

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
SIGNATURE_HEADER = 'Tiktok-Signature'
# TikTok signs `{timestamp}.{raw body}`. The relay receives the delivery directly from TikTok and refuses one
# older than this strict window (deploy/shared/tiktok-relay.mjs, SIGNATURE_MAX_AGE_SECONDS).
SIGNATURE_MAX_AGE = 5
# The tenant is the second hop: it trusts the relay's verification, not its own clock against TikTok's. The
# forward alone has a 10s budget (deploy/shared/tiktok-relay.mjs FORWARD_TIMEOUT_MS) and the two hosts' clocks
# differ by seconds, so re-checking the original timestamp against the relay's own window would refuse valid
# deliveries (issue A09-F4). The wider window is what a replay could reuse, and `liwan.inbox.event`'s dedupe
# key is what makes such a replay a single stored delivery, so the two limits are decided together.
SIGNATURE_MAX_AGE_RELAY = 30
IMAGE_MIMETYPES = frozenset({'image/jpeg', 'image/png'})
IMAGE_MAX_BYTES = 3 * 1024 * 1024
TEXT_MAX = 6000
CARD_TITLE_MAX = 40
BUTTON_TITLE_MAX = 20
BUTTON_ID_MAX = 40
MAX_BUTTONS = 3
WELCOME_MAX = 250
QUESTION_MAX = 80
ANSWER_MAX = 200
PROMPT_TITLE_MAX = 18
PROMPT_CONTENT_MAX = 150
MAX_QUESTIONS = 3
MAX_PROMPTS = 6
HISTORY_MESSAGES = 20
TIMEOUT_SECONDS = 10
UPLOAD_TIMEOUT_SECONDS = 60
DOWNLOAD_TIMEOUT_SECONDS = 60
MAX_MEDIA_BYTES = 16 * 1024 * 1024
# TikTok does not publish the host of a media download URL, so the token headers go only to TikTok-owned domains:
# the host equals one of these or is a subdomain of it.
MEDIA_DOMAINS = ('tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com')
CONVERSATION_PAGE = 100
ERROR_TEXT_LENGTH = 200
WEBHOOK_EVENT = 'DIRECT_MESSAGE'
# The message types of the webhook content (lowercase) and of the REST answers (uppercase), read as one.
MESSAGE_KINDS = {
    'text': 'text',
    'image': 'image',
    'video': 'video',
    'share_post': 'text',
    'emoji': 'sticker',
    'sticker': 'sticker',
    'template': 'interactive',
}
MEDIA_TYPES = {'image': 'IMAGE', 'video': 'VIDEO'}


@dataclass(frozen=True)
class AppConfig:
    """The operator's own TikTok app: environment configuration, never a channel field."""
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


@dataclass(frozen=True)
class Media:
    content: bytes
    mimetype: str


@dataclass(frozen=True)
class Button:
    """One reply button of a button card; `id` comes back as `reply_source_unique_id` when it is tapped."""
    id: str
    title: str


@dataclass(frozen=True)
class InboundMessage:
    provider_id: str
    conversation_id: str
    sender_id: str
    sender_name: str
    sent_at: datetime
    kind: str
    body: str = ''
    media_id: str | None = None
    media_type: str | None = None
    context_id: str | None = None
    option_id: str | None = None
    echo: bool = False
    auto: bool = False


@dataclass(frozen=True)
class Reaction:
    conversation_id: str
    target_id: str
    emoji: str | None


@dataclass(frozen=True)
class ReadUpTo:
    conversation_id: str
    read_at: datetime


@dataclass(frozen=True)
class Referral:
    conversation_id: str
    sender_id: str
    sender_name: str
    source: str
    ref: str | None


@dataclass(frozen=True)
class EuNotice:
    """A European sender's message: TikTok delivers no content, so the channel must poll for it."""
    received_at: datetime


@dataclass(frozen=True)
class AutoMessageChanged:
    """An automatic message was approved, rejected, created, updated or enabled/disabled."""


def app_config(environ):
    """The app configuration of `environ`, or None when the operator has not set all three variables."""
    values = [
        (environ.get(key) or '').strip()
        for key in ('LIWAN_TIKTOK_CLIENT_KEY', 'LIWAN_TIKTOK_CLIENT_SECRET', 'LIWAN_TIKTOK_REDIRECT_URI')
    ]
    return AppConfig(*values) if all(values) else None


def verify_signature(secret, raw, header, now, max_age=SIGNATURE_MAX_AGE):
    """True when `header` ("t=<unix s>,s=<hex>") signs `raw` and is within ``max_age`` seconds of `now`.

    The window is symmetric: a timestamp dated in the future is refused like a stale one, because
    it would otherwise escape the replay window as the clock advances. The relay uses the strict
    ``SIGNATURE_MAX_AGE``; the tenant, which trusts the relay's verification, the wider
    ``SIGNATURE_MAX_AGE_RELAY``.
    """
    parts = {}
    for part in (header or '').split(','):
        key, _, value = part.partition('=')
        if key and value:
            parts[key] = value
    try:
        timestamp = int(parts.get('t', ''))
    except ValueError:
        return False
    signature = parts.get('s', '')
    if not secret or not signature:
        return False
    # The header is decoded as latin-1, so it may carry bytes above 0x7F; a hex digest is ASCII, and
    # comparing a non-ASCII str with `compare_digest` raises instead of answering False.
    if not signature.isascii():
        return False
    digest = hmac.new(secret.encode(), b'%d.' % timestamp + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, signature):
        return False
    return abs(now - timestamp) <= max_age


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


def event_business_id(payload):
    """The `open_id` of the business account a webhook delivery belongs to, when the envelope carries one."""
    value = _dict(payload).get('user_openid')
    return value if isinstance(value, str) and value else None


def parse_event(payload, business_id):
    """The items of one webhook delivery addressed to `business_id`; another account's delivery yields nothing."""
    envelope = _dict(payload)
    if _text(envelope.get('user_openid')) != business_id:
        return []
    event = _text(envelope.get('event'))
    content = _content(envelope.get('content'))
    if event in ('im_receive_msg', 'im_send_msg'):
        return _reaction(content) if _text(content.get('type')).lower() == 'reaction' else [_webhook_message(content)]
    if event == 'im_mark_read_msg':
        return _read(content)
    if event == 'im_receive_msg_eu':
        return [EuNotice(_timestamp(content.get('timestamp')))]
    if event == 'im_referral_msg':
        return _referral(content)
    if event in ('im_auto_message_audit_update', 'im_auto_message_config_update'):
        return [AutoMessageChanged()]
    return []


def image_send_capable(credentials, conversation_id):
    """True when this conversation may receive an image (TikTok limits it to some country pairs)."""
    data = _answer(_call('GET', _api('business/message/capabilities/get/'), credentials.access_token, params={
        'business_id': credentials.business_id,
        'conversation_id': conversation_id,
        'conversation_type': 'SINGLE',
        'capability_types': json.dumps(['IMAGE_SEND']),
    }))
    return _capability_result(data)


def _media_host(host):
    return any(host == domain or host.endswith(f'.{domain}') for domain in MEDIA_DOMAINS)


def fetch_media(credentials, conversation_id, message_id, media_id, media_type):
    """Download one message's media; TikTok gates the download URL itself behind the `x-user` header."""
    data = _answer(_call('POST', _api('business/message/media/download/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'conversation_id': conversation_id,
        'message_id': message_id,
        'media_id': media_id,
        'media_type': media_type,
    }))
    url = _require_text(data, 'download_url')
    content, content_type = media_download.download(
        url, _media_host, {'Access-Token': credentials.access_token, 'x-user': credentials.access_token},
        DOWNLOAD_TIMEOUT_SECONDS, DOWNLOAD_TIMEOUT_SECONDS, MAX_MEDIA_BYTES,
    )
    mimetype = (content_type or '').split(';')[0].strip()
    return Media(content, mimetype)


def send_text(credentials, conversation_id, body, context_id=None):
    """Send a text (up to `TEXT_MAX`), optionally quoting `context_id`; returns the provider message id."""
    if not isinstance(body, str) or not 0 < len(body) <= TEXT_MAX:
        raise ValueError(f'a TikTok text is 1 to {TEXT_MAX} characters')
    content = {'message_type': 'TEXT', 'text': {'body': body}}
    if context_id:
        content['referenced_message_info'] = {'referenced_message_id': context_id}
    return _message_id(_answer(_call('POST', _api('business/message/send/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'recipient_type': 'CONVERSATION',
        'recipient': conversation_id,
        **content,
    })))


def upload_image(credentials, filename, mimetype, data):
    """Upload one JPEG or PNG (up to 3 MB) and return the media id a later `send_image` uses."""
    if mimetype not in IMAGE_MIMETYPES:
        message = 'a TikTok image is JPEG or PNG'
        raise ValueError(message)
    if not data or len(data) > IMAGE_MAX_BYTES:
        raise ValueError(f'a TikTok image is at most {IMAGE_MAX_BYTES} bytes')
    answer = _answer(_call(
        'POST', _api('business/message/media/upload/'), credentials.access_token, timeout=UPLOAD_TIMEOUT_SECONDS,
        data={'business_id': credentials.business_id, 'media_type': 'IMAGE'},
        files={'file': (filename, data, mimetype)},
    ))
    return _require_text(answer, 'media_id')


def send_image(credentials, conversation_id, media_id):
    """Send an uploaded image as its own message; returns the provider message id."""
    return _message_id(_answer(_call('POST', _api('business/message/send/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'recipient_type': 'CONVERSATION',
        'recipient': conversation_id,
        'message_type': 'IMAGE',
        'image': {'media_id': media_id},
    })))


def send_buttons(credentials, conversation_id, title, buttons):
    """Send a QA button card (a title and 1 to 3 reply buttons); returns the provider message id."""
    _validate_card(title, buttons)
    return _message_id(_answer(_call('POST', _api('business/message/send/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'recipient_type': 'CONVERSATION',
        'recipient': conversation_id,
        'message_type': 'TEMPLATE',
        'template': {
            'type': 'QA_BUTTON_CARD',
            'title': title,
            'buttons': [{'type': 'REPLY', 'title': button.title, 'id': button.id} for button in buttons],
        },
    })))


def send_action(credentials, conversation_id, action):
    """Send a sender action (`TYPING` or `MARK_READ`); nothing is stored as a message."""
    if action not in ('TYPING', 'MARK_READ'):
        message = 'a TikTok sender action is TYPING or MARK_READ'
        raise ValueError(message)
    _answer(_call('POST', _api('business/message/send/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'recipient_type': 'CONVERSATION',
        'recipient': conversation_id,
        'message_type': 'SENDER_ACTION',
        'sender_action': action,
    }))


def list_conversations(credentials, conversation_type, cursor):
    """One page of conversations and its next cursor, or None on the last page."""
    data = _answer(_call('GET', _api('business/message/conversation/list/'), credentials.access_token, params={
        'business_id': credentials.business_id,
        'conversation_type': conversation_type,
        'limit': CONVERSATION_PAGE,
        'cursor': cursor,
    }))
    return _dicts(data.get('conversations')), _next_cursor(data)


def list_messages(credentials, conversation_id):
    """A conversation's participants and its newest `HISTORY_MESSAGES` messages, parsed.

    TikTok refuses an unencoded `+` in `conversation_id`, so the query is built with `quote`.
    """
    query = urlencode({'business_id': credentials.business_id, 'conversation_id': conversation_id}, quote_via=quote)
    data = _answer(_call('GET', f"{_api('business/message/content/list/')}?{query}", credentials.access_token))
    participants = _dicts(data.get('participants'))
    names = {item.get('id'): _text(item.get('display_name')) for item in participants if isinstance(item.get('id'), str)}
    return participants, [_rest_message(item, names) for item in _dicts(data.get('messages'))]


def get_auto_messages(credentials, auto_type):
    """The account-wide operation status of one automatic message type and its stored items."""
    data = _answer(_call('GET', _api('business/message/auto_message/get/'), credentials.access_token, params={
        'business_id': credentials.business_id,
        'auto_message_type': auto_type,
    }))
    return _text(data.get('operation_status')), _dicts(data.get('auto_messages'))


def create_auto_message(credentials, auto_type, content):
    """Create one welcome message, suggested question or chat prompt; returns TikTok's id for it."""
    data = _answer(_call('POST', _api('business/message/auto_message/create/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'auto_message_type': auto_type,
        **content,
    }))
    return _require_text(_dict(data.get('auto_message')), 'auto_message_id')


def update_auto_message(credentials, auto_type, auto_id, content):
    """Replace one automatic message's content; TikTok refuses this while its audit is reviewing."""
    _answer(_call('POST', _api('business/message/auto_message/update/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'auto_message_type': auto_type,
        'auto_message_id': auto_id,
        **content,
    }))


def delete_auto_message(credentials, auto_type, auto_id):
    """Delete one automatic message."""
    _answer(_call('POST', _api('business/message/auto_message/delete/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'auto_message_type': auto_type,
        'auto_message_id': auto_id,
    }))


def set_auto_message_status(credentials, auto_type, enabled):
    """Enable or disable one automatic message type for the whole account.

    Enabling suggested questions or chat prompts disables every existing item of that type.
    """
    _answer(_call('POST', _api('business/message/auto_message/status/update/'), credentials.access_token, json={
        'business_id': credentials.business_id,
        'auto_message_type': auto_type,
        'operation_status': 'ENABLE' if enabled else 'DISABLE',
    }))


def webhook_show(config):
    """The callback URL subscribed for direct messages, or None when the app has no subscription."""
    data = _answer(_call('GET', _api('business/webhook/list/'), params={
        'app_id': config.client_key,
        'secret': config.client_secret,
        'event_type': WEBHOOK_EVENT,
    }))
    url = data.get('callback_url')
    return url if isinstance(url, str) and url else None


def webhook_register(config, callback_url):
    """Subscribe the app's single direct-message webhook to `callback_url`."""
    _answer(_call('POST', _api('business/webhook/update/'), json={
        'app_id': config.client_key,
        'secret': config.client_secret,
        'event_type': WEBHOOK_EVENT,
        'callback_url': callback_url,
    }))


def webhook_delete(config):
    """Delete the app's direct-message subscription."""
    _answer(_call('POST', _api('business/webhook/delete/'), json={
        'app_id': config.client_key,
        'secret': config.client_secret,
        'event_type': WEBHOOK_EVENT,
    }))


def _api(path):
    return f'{API_BASE}/{path}'


def _call(method, url, token=None, timeout=TIMEOUT_SECONDS, headers=None, **kwargs):
    headers = dict(headers or {})
    if token:
        headers['Access-Token'] = token
    try:
        response = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
    except requests.exceptions.ReadTimeout:
        # The request reached TikTok and the answer did not arrive: a retry could deliver the message twice.
        message = 'provider did not confirm the send'
        raise errors.ProviderError(message, retryable=False, unconfirmed=True) from None
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


def _capability_result(data):
    for capability in _dicts(data.get('capability_infos')):
        if capability.get('capability_type') == 'IMAGE_SEND':
            return capability.get('capability_result') is True
    return False


def _message_id(data):
    return _require_text(_dict(data.get('message')), 'message_id')


def _next_cursor(data):
    cursor = data.get('cursor')
    return cursor if data.get('has_more') and isinstance(cursor, int) and not isinstance(cursor, bool) else None


def _validate_card(title, buttons):
    if not 1 <= len(buttons) <= MAX_BUTTONS:
        raise ValueError(f'a TikTok button card has 1 to {MAX_BUTTONS} buttons')
    if not isinstance(title, str) or not 0 < len(title) <= CARD_TITLE_MAX:
        raise ValueError(f'a TikTok button card title is 1 to {CARD_TITLE_MAX} characters')
    for button in buttons:
        if not 0 < len(button.id) <= BUTTON_ID_MAX:
            raise ValueError(f'a TikTok button id is 1 to {BUTTON_ID_MAX} characters')
        if not 0 < len(button.title) <= BUTTON_TITLE_MAX:
            raise ValueError(f'a TikTok button title is 1 to {BUTTON_TITLE_MAX} characters')


def _dict(value):
    return value if isinstance(value, dict) else {}


def _dicts(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _text(value):
    return value if isinstance(value, str) else ''


def _timestamp(value):
    """TikTok timestamps are milliseconds since the epoch; the inbox stores naive UTC datetimes."""
    seconds = _seconds(value)
    return datetime.fromtimestamp(seconds / 1000, timezone.utc).replace(tzinfo=None)


def _content(value):
    """The event's own object: the envelope carries it as a JSON string, tests may pass it already parsed."""
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or '{}')
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _require_text(data, key):
    value = data.get(key)
    if not isinstance(value, str) or not value:
        message = 'malformed provider response'
        raise errors.ProviderError(message, retryable=False)
    return value


def _party(content, side):
    return _dict(content.get(side))


def _role(content, side):
    return _text(_party(content, side).get('role')).lower()


def _message_fields(kind, content):
    """`(body, media_id, media_type)` of one message, by its type."""
    block = _dict(content.get(kind.lower()))
    if kind.lower() == 'text':
        return _text(block.get('body')), None, None
    if kind.lower() == 'image':
        return '', _text(block.get('media_id')) or None, 'IMAGE'
    if kind.lower() == 'video':
        return '', _text(block.get('media_id')) or None, 'VIDEO'
    if kind.lower() == 'share_post':
        return _text(block.get('embed_url')), None, None
    if kind.lower() in ('emoji', 'sticker'):
        return _text(block.get('url')), None, None
    if kind.lower() == 'template':
        elements = _dicts(block.get('elements'))
        return _text(_dict(elements[0]).get('title')) if elements else '', None, None
    return '', None, None


def _webhook_message(content):
    type_name = _text(content.get('type'))
    kind = MESSAGE_KINDS.get(type_name.lower(), 'unsupported')
    body, media_id, media_type = _message_fields(type_name, content)
    return InboundMessage(
        provider_id=_text(content.get('message_id')),
        conversation_id=_text(content.get('conversation_id')),
        sender_id=_text(_party(content, 'from_user').get('id')),
        sender_name=_text(content.get('from')),
        sent_at=_timestamp(content.get('timestamp')),
        kind=kind,
        body=body,
        media_id=media_id,
        media_type=media_type or MEDIA_TYPES.get(kind),
        context_id=_text(_dict(content.get('referenced_message_info')).get('referenced_message_id')) or None,
        option_id=_text(_dict(content.get('reply_source_payload')).get('reply_source_unique_id')) or None,
        echo=_role(content, 'from_user') == 'business_account',
        auto=bool(content.get('auto_message_type')),
    )


def _rest_message(content, names):
    type_name = _text(content.get('message_type'))
    kind = MESSAGE_KINDS.get(type_name.lower(), 'unsupported')
    body, media_id, media_type = _message_fields(type_name, content)
    sender_id = _text(_party(content, 'from_user').get('id'))
    return InboundMessage(
        provider_id=_text(content.get('message_id')),
        conversation_id=_text(content.get('conversation_id')),
        sender_id=sender_id,
        sender_name=names.get(sender_id) or _text(content.get('sender')),
        sent_at=_timestamp(content.get('timestamp')),
        kind=kind,
        body=body,
        media_id=media_id,
        media_type=media_type or MEDIA_TYPES.get(kind),
        context_id=_text(_dict(content.get('referenced_message_info')).get('referenced_message_id')) or None,
        option_id=_text(_dict(content.get('reply_source_payload')).get('reply_source_unique_id')) or None,
        echo=_role(content, 'from_user') == 'business_account',
        auto=bool(content.get('auto_message_type')),
    )


def _reaction(content):
    reaction = _dicts(content.get('reaction'))
    if not reaction:
        return []
    latest = reaction[-1]
    emoji = _text(latest.get('emoji')) or None
    return [Reaction(
        conversation_id=_text(content.get('conversation_id')),
        target_id=_text(latest.get('original_msg_id')),
        emoji=emoji if _text(latest.get('operation')).upper() != 'REMOVE' else None,
    )]


def _read(content):
    if _role(content, 'from_user') != 'personal_account':
        return []
    return [ReadUpTo(
        conversation_id=_text(content.get('conversation_id')),
        read_at=_timestamp(_dict(content.get('read')).get('last_read_timestamp')),
    )]


def _referral(content):
    referral = _dict(content.get('referral'))
    source = _text(referral.get('source'))
    ref = _dict(referral.get('ad')).get('ad_id') if source == 'ad' else _dict(referral.get('short_link')).get('ref')
    return [Referral(
        conversation_id=_text(content.get('conversation_id')),
        sender_id=_text(_party(content, 'from_user').get('id')),
        sender_name=_text(content.get('from')),
        source=source,
        ref=_text(ref) or None,
    )]
