# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""WhatsApp Cloud API: pure functions over `requests`, no Odoo environment.

Every call has a fixed timeout and never logs or returns the access token.
"""
import hashlib
import hmac
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import requests
import urllib3

GRAPH_API_VERSION = 'v26.0'
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
FLOWS_FIELD = 'flows'
# The webhook fields that name the business account (entry.id) instead of a phone number.
FLOW_MESSAGE_VERSION = '3'
# The answers of a completed form (`nfm_reply.response_json`) are read up to this size.
MAX_RESPONSE_JSON_BYTES = 64 * 1024
FLOW_ERROR_LENGTH = 500
FLOW_PATH_LENGTH = 255
PHONE_QUALITY_FIELD = 'phone_number_quality_update'
PHONE_NAME_FIELD = 'phone_number_name_update'
ACCOUNT_UPDATE_FIELD = 'account_update'
CAPABILITY_FIELD = 'business_capability_update'
ACCOUNT_ALERTS_FIELD = 'account_alerts'
HEALTH_FIELDS = frozenset({PHONE_QUALITY_FIELD, PHONE_NAME_FIELD, ACCOUNT_UPDATE_FIELD, CAPABILITY_FIELD, ACCOUNT_ALERTS_FIELD})
# The webhook fields that name a business account (entry.id) and no phone number id.
ACCOUNT_FIELDS = TEMPLATE_FIELDS | HEALTH_FIELDS | {FLOWS_FIELD}
USER_PREFERENCES_FIELD = 'user_preferences'
MARKETING_CATEGORY = 'marketing_messages'
MARKETING_PATH = 'marketing_messages'
CLOUD_PATH = 'messages'
PRODUCT_POLICY = 'CLOUD_API_FALLBACK'
HELD_STATUS = 'held_for_quality_assessment'
# Meta error codes that a later attempt may cure: throughput, WABA and app rate limits, pair rate, maintenance, unknown.
RETRYABLE_CODES = frozenset({130429, 80007, 4, 131056, 131057, 131000, 131016})
MARKETING_ONBOARDING = {'ELIGIBLE': 'eligible', 'ONBOARDED': 'onboarded'}
NO_REASON = 'NONE'
NON_DIGITS = re.compile(r'\D')
# Meta's messaging limit words and the integers of the capability webhook, as the channel's `messaging_limit` keys.
MESSAGING_LIMITS = {
    'TIER_50': 'tier_50', 'TIER_250': 'tier_250', 'TIER_2K': 'tier_2k', 'TIER_10K': 'tier_10k', 'TIER_100K': 'tier_100k',
    'TIER_UNLIMITED': 'unlimited', 'TIER_NOT_SET': 'not_set',
    50: 'tier_50', 250: 'tier_250', 2000: 'tier_2k', 10000: 'tier_10k', 100000: 'tier_100k', -1: 'unlimited',
}
NAME_STATUSES = {
    'APPROVED': 'approved', 'AVAILABLE_WITHOUT_REVIEW': 'available_without_review', 'DECLINED': 'declined',
    'EXPIRED': 'expired', 'PENDING_REVIEW': 'pending_review', 'NONE': 'none',
}
QUALITY_RATINGS = {'GREEN': 'green', 'YELLOW': 'yellow', 'RED': 'red'}
THROUGHPUT_LEVELS = {'STANDARD': 'standard', 'HIGH': 'high', 'NOT_APPLICABLE': 'not_applicable'}
PRICING_CATEGORIES = frozenset({
    'authentication', 'authentication_international', 'marketing', 'marketing_lite', 'service', 'utility', 'referral_conversion',
})
PRICING_TYPES = frozenset({'regular', 'free_customer_service', 'free_entry_point'})
UNKNOWN = 'unknown'
UNKNOWN_COUNTRY = 'ZZ'
# Account alerts that tell the business its messaging limit will not grow.
SCALING_DENIED_ALERTS = frozenset({
    'INCREASED_CAPABILITIES_ELIGIBILITY_DEFERRED', 'INCREASED_CAPABILITIES_ELIGIBILITY_FAILED',
    'INCREASED_CAPABILITIES_ELIGIBILITY_NEED_MORE_INFO',
})
PHONE_HEALTH_FIELDS = (
    'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,new_name_status,'
    'throughput,whatsapp_business_manager_messaging_limit'
)
BUSINESS_VERTICALS = frozenset({
    'alcohol', 'apparel', 'auto', 'beauty', 'edu', 'entertain', 'event_plan', 'finance', 'govt', 'grocery', 'health',
    'hotel', 'nonprofit', 'online_gambling', 'otc_drugs', 'other', 'physical_gambling', 'prof_services', 'restaurant',
    'retail', 'travel',
})
CURRENCY = re.compile(r'^[A-Z]{3}$')
CLICK_TEXT_LENGTH = 64
PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical'
TEMPLATE_IDS_PER_REQUEST = 10
TEMPLATE_METRICS = '["SENT","DELIVERED","READ","CLICKED","COST"]'
PRICING_QUERY = (
    'pricing_analytics.start({start}).end({end}).granularity(DAILY).metric_types(["COST","VOLUME"])'
    '.dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY"]).phone_numbers(["{number}"])'
)
CATALOG_ID = re.compile(r'^\d{5,32}$')
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
    flow_response: 'FlowResponse | None' = None


@dataclass(frozen=True)
class FlowResponse:
    """The completed form of an `nfm_reply`: our `flow_token` and the answers. `values` is empty for a body we cannot read."""
    flow_token: str | None
    values: dict


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
    error_code: int | None = None


@dataclass(frozen=True)
class UserPreferenceUpdate:
    """The customer stopped (`stop`) or resumed (`resume`) marketing messages from inside WhatsApp."""
    wa_id: str
    value: str
    at: datetime | None


@dataclass(frozen=True)
class SendResult:
    """A sent message: its provider id, and whether Meta holds it for a template quality check."""
    provider_id: str
    held: bool


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
class FlowStatusUpdate:
    """A lifecycle change of a form; the statuses are Meta's upper-case words (PUBLISHED, DEPRECATED, BLOCKED, ...)."""
    flow_id: str
    old_status: str | None
    new_status: str


@dataclass(frozen=True)
class FlowVersionWarning:
    """Meta's notice that the Flow JSON version of a form will freeze or expire."""
    flow_id: str
    warning: str


FLOW_UPDATES = (FlowStatusUpdate, FlowVersionWarning)


@dataclass(frozen=True)
class QualityUpdate:
    """A change of the number's messaging limit or throughput; `event` is Meta's word (THROUGHPUT_UPGRADE, FLAGGED, ...)."""
    event: str
    current_limit: str | None
    old_limit: str | None
    occurred_at: datetime | None


@dataclass(frozen=True)
class NameUpdate:
    """The review decision (APPROVED, DEFERRED, PENDING, REJECTED) of a display-name change."""
    decision: str
    requested_name: str | None
    rejection_reason: str | None
    occurred_at: datetime | None


@dataclass(frozen=True)
class Restriction:
    kind: str
    expires_at: datetime | None


@dataclass(frozen=True)
class AccountUpdate:
    """A restriction, violation, disabling or reconnection of the business account (or of one number, `phone_scoped`)."""
    event: str
    ban_state: str | None
    ban_date: datetime | None
    violation_type: str | None
    restrictions: tuple[Restriction, ...]
    occurred_at: datetime | None


@dataclass(frozen=True)
class CapabilityUpdate:
    """The business portfolio's messaging limit changed (a `messaging_limit` key)."""
    limit: str
    occurred_at: datetime | None


@dataclass(frozen=True)
class AccountAlert:
    alert_type: str
    occurred_at: datetime | None


HEALTH_UPDATES = (QualityUpdate, NameUpdate, AccountUpdate, CapabilityUpdate, AccountAlert)


@dataclass(frozen=True)
class PhoneHealth:
    """Meta's current view of the number; a field Meta did not report is `unknown` (or None for the texts)."""
    display_phone_number: str | None
    verified_name: str | None
    name_status: str
    new_name_status: str
    quality_rating: str
    messaging_limit: str
    throughput_level: str
    code_verified: bool


@dataclass(frozen=True)
class PricingPoint:
    day: date
    category: str
    pricing_type: str
    country: str
    volume: int
    cost: float | None


@dataclass(frozen=True)
class TemplateClick:
    kind: str
    text: str
    count: int


@dataclass(frozen=True)
class TemplateDayPoint:
    template_id: str
    day: date
    sent: int
    delivered: int
    read: int
    clicks: tuple[TemplateClick, ...]
    amount_spent: float | None


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


def _flow_response(block):
    """The token and answers of an `nfm_reply`; a body that is too large or not a JSON object has no answers."""
    raw = _dict(block.get('nfm_reply')).get('response_json')
    values = {}
    if isinstance(raw, str) and len(raw.encode()) <= MAX_RESPONSE_JSON_BYTES:
        try:
            parsed = json.loads(raw)
        except (ValueError, RecursionError):
            parsed = None
        values = parsed if isinstance(parsed, dict) else {}
    token = values.get('flow_token')
    return FlowResponse(token if isinstance(token, str) and token else None, {k: v for k, v in values.items() if k != 'flow_token'})


def _inbound(raw, names):
    wire_kind = raw.get('type') or 'unknown'
    block = _dict(raw.get(wire_kind))
    kind = _kind(wire_kind)
    flow_response = None
    if kind == 'interactive' and block.get('type') == 'nfm_reply':
        kind, flow_response = 'flow_response', _flow_response(block)
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
        flow_response=flow_response,
        order=order,
        referred_product=_referred_product(raw) if kind == 'text' else None,
    )


def _reaction(raw):
    block = _dict(raw.get('reaction'))
    target = block.get('message_id')
    return InboundReaction(raw['from'], target, block.get('emoji') or '') if isinstance(target, str) else None


def _message_event(raw, names):
    return _reaction(raw) if raw.get('type') == 'reaction' else _inbound(raw, names)


def _well_formed(parse, raws, *args):
    """The events of `raws`; one entry missing a required field is dropped so it cannot fail the whole payload."""
    events = []
    for raw in raws:
        try:
            events.append(parse(raw, *args))
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue
    return [event for event in events if event]


def _int_or_none(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _status(raw):
    errors = _dicts(raw.get('errors'))
    return StatusUpdate(
        provider_id=raw['id'],
        status=raw['status'],
        sent_at=_timestamp(raw['timestamp']),
        error=(errors[0].get('title') or errors[0].get('message')) if errors else None,
        error_code=_int_or_none(errors[0].get('code')) if errors else None,
    )


def _preference(raw):
    """The marketing preference change of one `user_preferences` item, or None for another category or an unknown value."""
    wa_id, value = raw.get('wa_id'), raw.get('value')
    if raw.get('category') != MARKETING_CATEGORY or value not in ('stop', 'resume') or not isinstance(wa_id, str):
        return None
    stamp = str(raw.get('timestamp') or '')
    return UserPreferenceUpdate(wa_id, value, _timestamp(stamp) if stamp.isdigit() else None)


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


def _flow_event(value):
    """The typed form change of one `flows` webhook change, or None for the endpoint alerts and anything malformed."""
    flow_id = _text(value.get('flow_id'))
    if not flow_id:
        return None
    if value.get('event') == 'FLOW_STATUS_CHANGE' and isinstance(value.get('new_status'), str):
        old = value.get('old_status')
        return FlowStatusUpdate(flow_id, old if isinstance(old, str) else None, value['new_status'])
    if value.get('event') == 'FLOW_VERSION_EXPIRY_WARNING' and isinstance(value.get('warning'), str):
        return FlowVersionWarning(flow_id, value['warning'][:ERROR_TEXT_LENGTH])
    return None


def _digits(value):
    return NON_DIGITS.sub('', str(value)) if isinstance(value, (str, int)) and not isinstance(value, bool) else ''


def parse_limit(value):
    """The `messaging_limit` key of a Meta limit (a TIER_* word or an integer); None when absent, `unknown` when not one we know."""
    if value is None or isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    if isinstance(value, str):
        value = int(value) if value.lstrip('-').isdigit() else value.upper()
    return MESSAGING_LIMITS.get(value, UNKNOWN)


def _known_limit(value):
    """`parse_limit` of a limit that names a tier we know, else None."""
    limit = parse_limit(value)
    return None if limit == UNKNOWN else limit


def _occurred_at(entry):
    time = entry.get('time')
    return _timestamp(time) if isinstance(time, int) and not isinstance(time, bool) else None


def _scoped_to(number, display_number):
    """True when `number` (a display phone number as Meta writes it) is the channel's own number."""
    return bool(display_number) and _digits(number) == display_number


def _text_or_none(value):
    return value if isinstance(value, str) and value and value != NO_REASON else None


def _date_or_none(value):
    try:
        return datetime.fromisoformat(value).replace(tzinfo=None) if isinstance(value, str) else None
    except ValueError:
        return None


def _restriction(item):
    expiration = item.get('expiration')
    expires_at = _timestamp(expiration) if isinstance(expiration, int) and not isinstance(expiration, bool) else None
    return Restriction(item['restriction_type'], expires_at) if isinstance(item.get('restriction_type'), str) else None


ACCOUNT_ACTIONS = frozenset({
    'ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'DISABLED_UPDATE', 'ACCOUNT_OFFBOARDED', 'ACCOUNT_RECONNECTED',
})


def _account_update(value, occurred_at, display_number):
    event = value.get('event')
    if event not in ACCOUNT_ACTIONS:
        return None
    if value.get('phone_number') and not _scoped_to(value['phone_number'], display_number):
        return None  # a single-number event of another number of the account
    ban = _dict(value.get('ban_info'))
    restrictions = tuple(item for item in map(_restriction, _dicts(value.get('restriction_info'))) if item)
    return AccountUpdate(
        event, _text_or_none(ban.get('waba_ban_state')), _date_or_none(ban.get('waba_ban_date')),
        _text_or_none(_dict(value.get('violation_info')).get('violation_type')), restrictions, occurred_at,
    )


def _health_event(field, value, entry, display_number):
    """The typed health change of one webhook `change` for the channel whose number is `display_number`, or None."""
    occurred_at = _occurred_at(entry)
    if field == ACCOUNT_UPDATE_FIELD:
        return _account_update(value, occurred_at, display_number)
    if field == CAPABILITY_FIELD:
        limit = _known_limit(value.get('max_daily_conversations_per_business'))
        limit = limit or _known_limit(value.get('max_daily_conversation_per_phone'))
        return CapabilityUpdate(limit, occurred_at) if limit else None
    if field == ACCOUNT_ALERTS_FIELD:
        return AccountAlert(value['alert_type'], occurred_at) if value.get('alert_type') in SCALING_DENIED_ALERTS else None
    if not _scoped_to(value.get('display_phone_number'), display_number):
        return None
    if field == PHONE_NAME_FIELD and isinstance(value.get('decision'), str):
        return NameUpdate(
            value['decision'], _text_or_none(value.get('requested_verified_name')),
            _text_or_none(value.get('rejection_reason')), occurred_at,
        )
    if field == PHONE_QUALITY_FIELD and isinstance(value.get('event'), str):
        current = _known_limit(value.get('current_limit') or value.get('max_daily_conversations_per_business'))
        return QualityUpdate(value['event'], current, _known_limit(value.get('old_limit')), occurred_at)
    return None


def _account_event(field, value, entry, display_number):
    if field == FLOWS_FIELD:
        return _flow_event(value)
    return _template_event(field, value) if field in TEMPLATE_FIELDS else _health_event(field, value, entry, display_number)


def parse_events(payload, phone_number_id, business_account_id, display_phone_number=None):
    """The messages, reactions and status updates addressed to `phone_number_id` and the account and form changes of `business_account_id`.

    `display_phone_number` (digits) scopes the single-number health changes: a channel without one ignores them.
    """
    events = []
    for entry in _dicts(payload.get('entry')):
        for change in _dicts(entry.get('changes')):
            value = _dict(change.get('value'))
            if change.get('field') in ACCOUNT_FIELDS:
                event = _account_event(change['field'], value, entry, display_phone_number) if entry.get('id') == business_account_id else None
                events += [event] if event else []
                continue
            if _dict(value.get('metadata')).get('phone_number_id') != phone_number_id:
                continue
            names = {
                contact.get('wa_id'): _dict(contact.get('profile')).get('name')
                for contact in _dicts(value.get('contacts'))
            }
            events += _well_formed(_message_event, _dicts(value.get('messages')), names)
            events += _well_formed(_status, _dicts(value.get('statuses')))
            events += _well_formed(_preference, _dicts(value.get('user_preferences')))
    return events


def phone_number_ids(payload):
    """Every string metadata.phone_number_id a webhook payload addresses; other shapes are ignored."""
    ids = [
        _dict(_dict(change.get('value')).get('metadata')).get('phone_number_id')
        for entry in _dicts(payload.get('entry'))
        for change in _dicts(entry.get('changes'))
    ]
    return {value for value in ids if isinstance(value, str)}


def account_business_ids(payload):
    """The id of every business account that a template or form change of the payload names (entry.id)."""
    ids = [
        entry.get('id') for entry in _dicts(payload.get('entry'))
        if any(change.get('field') in ACCOUNT_FIELDS for change in _dicts(entry.get('changes')))
    ]
    return {value for value in ids if isinstance(value, str)}


def _error_code(response):
    try:
        return _int_or_none(response.json()['error']['code'])
    except (ValueError, KeyError, TypeError):
        return None


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
        code = _error_code(response)
        retryable = response.status_code >= 500 or response.status_code == 429 or code in RETRYABLE_CODES
        raise ProviderError(_error_text(response), retryable=retryable, code=code)
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


def _deliver(credentials, to, kind, content, context_id=None, path=CLOUD_PATH, extra=None):
    payload = {'messaging_product': 'whatsapp', 'to': to, 'type': kind, kind: content, **(extra or {})}
    if context_id:
        payload['context'] = {'message_id': context_id}
    response = _call('POST', _graph(f'{credentials.phone_number_id}/{path}'), credentials, json=payload)
    messages = _json_dict(response).get('messages')
    first = messages[0] if isinstance(messages, list) and messages and isinstance(messages[0], dict) else {}
    if not isinstance(first.get('id'), str):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return SendResult(first['id'], first.get('message_status') == HELD_STATUS)


def _send(credentials, to, kind, content, context_id=None):
    return _deliver(credentials, to, kind, content, context_id).provider_id


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
    """A url, copy-code or form button parameter given as {'index', 'sub_type': url|copy_code|flow, 'value'} (a form's value is its token)."""
    if button['sub_type'] == 'flow':
        parameter = {'type': 'action', 'action': {'flow_token': button['value']}}
    else:
        parameter = ({'type': 'coupon_code', 'coupon_code': button['value']} if button['sub_type'] == 'copy_code'
                     else {'type': 'text', 'text': button['value']})
    return {'type': 'button', 'sub_type': button['sub_type'], 'index': str(button['index']), 'parameters': [parameter]}


def send_template(credentials, to, name, language, params, header=None, buttons=(), marketing_api=False):
    """Send an approved template; `marketing_api` posts it to the Marketing Messages API (Cloud API as the fallback)."""
    content = {'name': name, 'language': {'code': language}}
    components = []
    if header:
        components.append({'type': 'header', 'parameters': [_header_parameter(header)]})
    if params:
        components.append({'type': 'body', 'parameters': [{'type': 'text', 'text': p} for p in params]})
    components += [_button_component(button) for button in buttons]
    if components:
        content['components'] = components
    if marketing_api:
        return _deliver(credentials, to, 'template', content, path=MARKETING_PATH, extra={'product_policy': PRODUCT_POLICY})
    return _deliver(credentials, to, 'template', content)


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


def _interactive_action(interactive, flow):
    if interactive['type'] == 'flow':
        return {'name': 'flow', 'parameters': {
            'flow_message_version': FLOW_MESSAGE_VERSION, 'flow_token': flow['token'], 'flow_id': flow['flow_id'],
            'flow_cta': interactive['cta'], 'flow_action': 'navigate', 'mode': 'published',
        }}
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


def send_interactive(credentials, to, interactive, context_id=None, flow=None):
    """Send an interactive message given as the wire shape of the inbox contract (buttons, list, cta_url or flow).

    A flow message also takes `flow`: Meta's id of the form and our `token` ({'flow_id', 'token'}).
    """
    content = {
        'type': 'button' if interactive['type'] == 'buttons' else interactive['type'],
        'body': {'text': interactive['body']},
        'action': _interactive_action(interactive, flow),
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


def upload_resumable(credentials, app_id, filename, mimetype, data):
    """Upload a file (a template header sample or the profile picture) with the resumable upload API and return its handle."""
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


# Flows: Meta lists a form's problems as `validation_errors`; all must be fixed before it is published.

def _flow_errors(data):
    errors = []
    for item in _dicts(data.get('validation_errors')):
        pointers = _dicts(item.get('pointers'))
        path = pointers[0].get('path') if pointers else None
        errors.append({
            'message': str(item.get('message') or item.get('error') or 'invalid')[:FLOW_ERROR_LENGTH],
            'path': path[:FLOW_PATH_LENGTH] if isinstance(path, str) and path else None,
            'line': item.get('line_start') if isinstance(item.get('line_start'), int) else None,
            'column': item.get('column_start') if isinstance(item.get('column_start'), int) else None,
        })
    return errors


def _flow_id(data):
    flow_id = data.get('id')
    if not isinstance(flow_id, (str, int)) or isinstance(flow_id, bool):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return str(flow_id)


def _first_category(data):
    categories = data.get('categories')
    return str(categories[0]).lower() if isinstance(categories, list) and categories and isinstance(categories[0], str) else None


def create_flow(credentials, name, category, flow_json):
    """Create a draft form with its generated Flow JSON; returns {'id', 'validation_errors'}."""
    data = _json_dict(_call(
        'POST', _graph(f'{credentials.business_account_id}/flows'), credentials, timeout=UPLOAD_TIMEOUT_SECONDS,
        json={'name': name, 'categories': [category.upper()], 'flow_json': flow_json},
    ))
    return {'id': _flow_id(data), 'validation_errors': _flow_errors(data)}


def update_flow_metadata(credentials, flow_id, name, category):
    _call('POST', _graph(flow_id), credentials, json={'name': name, 'categories': [category.upper()]})


def upload_flow_json(credentials, flow_id, flow_json):
    """Replace the Flow JSON of a draft; returns Meta's validation errors."""
    data = _json_dict(_call(
        'POST', _graph(f'{flow_id}/assets'), credentials, timeout=UPLOAD_TIMEOUT_SECONDS,
        data={'name': 'flow.json', 'asset_type': 'FLOW_JSON'},
        files={'file': ('flow.json', flow_json.encode(), 'application/json')},
    ))
    return _flow_errors(data)


def publish_flow(credentials, flow_id):
    _call('POST', _graph(f'{flow_id}/publish'), credentials)


def deprecate_flow(credentials, flow_id):
    _call('POST', _graph(f'{flow_id}/deprecate'), credentials)


def delete_flow(credentials, flow_id):
    _call('DELETE', _graph(flow_id), credentials)


def flow_details(credentials, flow_id):
    """The state of one form: status, Flow JSON version and whether this phone number can send it now."""
    fields = f'name,status,categories,json_version,validation_errors,health_status.phone_number({credentials.phone_number_id})'
    data = _json_dict(_call('GET', _graph(flow_id), credentials, params={'fields': fields}))
    health = _dict(data.get('health_status')).get('can_send_message')
    return {
        'name': data.get('name') if isinstance(data.get('name'), str) else None,
        'status': data.get('status') if isinstance(data.get('status'), str) else None,
        'category': _first_category(data),
        'json_version': data.get('json_version') if isinstance(data.get('json_version'), str) else None,
        'health': health if isinstance(health, str) else None,
        'validation_errors': _flow_errors(data),
    }


def list_flows(credentials):
    """Every form of the business account as Meta lists it: id, name, status, category and validation errors."""
    flows, after = [], None
    for _page in range(MAX_TEMPLATE_PAGES):
        params = {'fields': 'id,name,status,categories,validation_errors', 'limit': 100}
        if after:
            params['after'] = after
        data = _json_dict(_call('GET', _graph(f'{credentials.business_account_id}/flows'), credentials, params=params))
        for item in _dicts(data.get('data')):
            if not isinstance(item.get('name'), str) or not isinstance(item.get('status'), str):
                message = 'malformed provider response'
                raise ProviderError(message, retryable=False)
            flows.append({
                'id': _flow_id(item), 'name': item['name'], 'status': item['status'],
                'category': _first_category(item), 'validation_errors': _flow_errors(item),
            })
        paging = _dict(data.get('paging'))
        after = _dict(paging.get('cursors')).get('after') if paging.get('next') else None
        if not after:
            break
    return flows


def flow_preview(credentials, flow_id):
    """Meta's web preview of a form: {'url', 'expires_at'} (a UTC datetime); the link needs no login."""
    data = _json_dict(_call('GET', _graph(flow_id), credentials, params={'fields': 'preview.invalidate(false)'}))
    preview = _dict(data.get('preview'))
    url, expires = preview.get('preview_url'), preview.get('expires_at')
    try:
        expires_at = datetime.strptime(expires, '%Y-%m-%dT%H:%M:%S%z').astimezone(timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        expires_at = None
    if not (isinstance(url, str) and url.startswith('https://') and expires_at):
        message = 'malformed provider response'
        raise ProviderError(message, retryable=False)
    return {'url': url, 'expires_at': expires_at}


def _enum(value, known):
    """The lower-case key of Meta's upper-case word when it is one of `known`, else `unknown`."""
    return known.get(value.upper(), UNKNOWN) if isinstance(value, str) else UNKNOWN


def _require_success(response):
    if _json_dict(response).get('success') is not True:
        message = 'the provider did not accept the request'
        raise ProviderError(message, retryable=False)


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _amount(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


def fetch_phone_health(credentials):
    """Meta's current view of the phone number; raises ProviderError unless it is reachable with the token."""
    data = _json_dict(_call(
        'GET', _graph(credentials.phone_number_id), credentials, params={'fields': PHONE_HEALTH_FIELDS},
    ))
    name = data.get('verified_name')
    return PhoneHealth(
        display_phone_number=_digits(data.get('display_phone_number')) or None,
        verified_name=name if isinstance(name, str) and name else None,
        name_status=_enum(data.get('name_status'), NAME_STATUSES),
        new_name_status=_enum(data.get('new_name_status'), NAME_STATUSES),
        quality_rating=_enum(data.get('quality_rating'), QUALITY_RATINGS),
        messaging_limit=parse_limit(data.get('whatsapp_business_manager_messaging_limit')) or UNKNOWN,
        throughput_level=_enum(_dict(data.get('throughput')).get('level'), THROUGHPUT_LEVELS),
        code_verified=data.get('code_verification_status') == 'VERIFIED',
    )


def fetch_marketing_onboarding(credentials):
    """The business account's Marketing Messages API onboarding: not_started (no status), eligible, onboarded or unknown."""
    data = _json_dict(_call(
        'GET', _graph(credentials.business_account_id), credentials, params={'fields': 'marketing_messages_onboarding_status'},
    ))
    status = data.get('marketing_messages_onboarding_status')
    if status is None:
        return 'not_started'
    return MARKETING_ONBOARDING.get(status.upper(), UNKNOWN) if isinstance(status, str) else UNKNOWN


def get_business_profile(credentials):
    """The live business profile as the inbox contract shapes it (texts and vertical None when empty)."""
    data = _json_dict(_call(
        'GET', _graph(f'{credentials.phone_number_id}/whatsapp_business_profile'), credentials,
        params={'fields': PROFILE_FIELDS},
    ))
    profile = next(iter(_dicts(data.get('data'))), {})
    vertical = profile.get('vertical').lower() if isinstance(profile.get('vertical'), str) else None
    return {
        **{key: profile[key] if isinstance(profile.get(key), str) and profile[key] else None
           for key in ('about', 'address', 'description', 'email')},
        'websites': [site for site in profile.get('websites') or [] if isinstance(site, str)][:2],
        'vertical': vertical if vertical in BUSINESS_VERTICALS else None,
        'picture_url': profile['profile_picture_url'] if isinstance(profile.get('profile_picture_url'), str) else None,
    }


def update_business_profile(credentials, values, picture_handle=None):
    """Write the given profile fields (an omitted field stays, '' or an empty list clears it) and/or a picture handle."""
    payload = {'messaging_product': 'whatsapp', **values}
    if 'vertical' in values:
        payload['vertical'] = (values['vertical'] or '').upper()
    if picture_handle:
        payload['profile_picture_handle'] = picture_handle
    _require_success(_call(
        'POST', _graph(f'{credentials.phone_number_id}/whatsapp_business_profile'), credentials, json=payload,
    ))


def request_display_name(credentials, name):
    """Ask Meta to review a new display name (the decision arrives as a `phone_number_name_update`)."""
    _require_success(_call('POST', _graph(credentials.phone_number_id), credentials, json={'new_display_name': name}))


def set_two_step_pin(credentials, pin):
    """Set or change the six-digit two-step verification PIN. The PIN is only ever sent, never kept or reported."""
    _require_success(_call('POST', _graph(credentials.phone_number_id), credentials, json={'pin': pin}))


def register(credentials, pin):
    """Register the number on the Cloud API; `pin` must match its two-step PIN, or becomes it when none is set."""
    _require_success(_call(
        'POST', _graph(f'{credentials.phone_number_id}/register'), credentials,
        json={'messaging_product': 'whatsapp', 'pin': pin},
    ))


def _unix(day):
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())


def _pricing_point(item):
    start = item.get('start')
    if not isinstance(start, int) or isinstance(start, bool):
        return None
    category, pricing_type = str(item.get('pricing_category') or '').lower(), str(item.get('pricing_type') or '').lower()
    country = item.get('country')
    return PricingPoint(
        day=_timestamp(start).date(),
        category=category if category in PRICING_CATEGORIES else UNKNOWN,
        pricing_type=pricing_type if pricing_type in PRICING_TYPES else UNKNOWN,
        country=country.upper() if isinstance(country, str) and len(country) == 2 and country.isalpha() else UNKNOWN_COUNTRY,
        volume=_count(item.get('volume')),
        cost=_amount(item.get('cost')),
    )


def fetch_pricing(credentials, display_number, start, end):
    """Meta's daily volume and cost of one number between the UTC days `start` and `end` (both included)."""
    fields = PRICING_QUERY.format(start=_unix(start), end=_unix(end + timedelta(days=1)), number=display_number)
    data = _json_dict(_call('GET', _graph(credentials.business_account_id), credentials, params={'fields': fields}))
    groups = _dicts(_dict(data.get('pricing_analytics')).get('data'))
    points = (_pricing_point(item) for group in groups for item in _dicts(group.get('data_points')))
    return [point for point in points if point]


def fetch_currency(credentials):
    """The billing currency of the business account, or None when Meta does not report one."""
    data = _json_dict(_call('GET', _graph(credentials.business_account_id), credentials, params={'fields': 'currency'}))
    currency = data.get('currency')
    return currency if isinstance(currency, str) and CURRENCY.match(currency) else None


def enable_template_insights(credentials):
    """Turn on template analytics for the business account. Meta does not allow turning it off again."""
    _require_success(_call(
        'POST', _graph(credentials.business_account_id), credentials, params={'is_enabled_for_insights': 'true'},
    ))


def _click(item):
    kind = str(item.get('type') or '')
    return TemplateClick(
        'quick_reply' if 'quick_reply' in kind else 'url' if 'url' in kind else UNKNOWN,
        str(item.get('button_content') or '')[:CLICK_TEXT_LENGTH], _count(item.get('count')),
    )


def _template_day(item):
    start, template_id = item.get('start'), _text(item.get('template_id'))
    if not template_id or not isinstance(start, int) or isinstance(start, bool):
        return None
    cost = {entry.get('type'): entry.get('value') for entry in _dicts(item.get('cost'))}
    return TemplateDayPoint(
        template_id, _timestamp(start).date(), _count(item.get('sent')), _count(item.get('delivered')),
        _count(item.get('read')), tuple(_click(click) for click in _dicts(item.get('clicked'))),
        _amount(cost.get('amount_spent')),
    )


def fetch_template_analytics(credentials, template_ids, start, end):
    """Meta's daily sent, delivered, read, clicked and spent figures of up to ten templates between two UTC days."""
    params = {
        'start': _unix(start), 'end': _unix(end + timedelta(days=1)), 'granularity': 'DAILY',
        'template_ids': '[' + ','.join(template_ids) + ']', 'metric_types': TEMPLATE_METRICS,
    }
    points, after = [], None
    for _page in range(MAX_TEMPLATE_PAGES):
        data = _json_dict(_call(
            'GET', _graph(f'{credentials.business_account_id}/template_analytics'), credentials,
            params={**params, **({'after': after} if after else {})},
        ))
        points += [point for group in _dicts(data.get('data')) for point in map(_template_day, _dicts(group.get('data_points'))) if point]
        paging = _dict(data.get('paging'))
        after = _dict(paging.get('cursors')).get('after') if paging.get('next') else None
        if not after:
            break
    return points
