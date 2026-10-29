# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The selections, the messaging-limit tiers and the Meta error-code table of the WhatsApp campaigns."""
from typing import NamedTuple

CONSENT_STATES = [('unknown', 'Unknown'), ('opted_in', 'Opted in'), ('opted_out', 'Opted out')]
CONSENT_SOURCES = [
    ('agent', 'Agent'), ('import', 'Import'), ('keyword', 'Keyword'), ('whatsapp', 'WhatsApp'),
    ('delivery_error', 'Delivery error'),
]
CONSENT_POLICIES = [('opted_in_only', 'Opted in only'), ('not_opted_out', 'Everyone who has not opted out')]
CAMPAIGN_STATES = [
    ('draft', 'Draft'), ('scheduled', 'Scheduled'), ('running', 'Running'), ('paused', 'Paused'), ('done', 'Done'),
    ('cancelled', 'Cancelled'),
]
PAUSE_REASONS = [
    ('manual', 'Manual'), ('template_unavailable', 'Template unavailable'), ('account_restricted', 'Account restricted'),
    ('payment', 'Payment'), ('token', 'Access token'), ('channel_disabled', 'Channel disabled'),
    ('messages_limit', 'Messages limit'), ('recipients_limit', 'Recipients limit'),
]
SKIP_REASONS = [
    ('opted_out', 'Opted out'), ('no_consent', 'No consent'),
    ('invalid_number', 'Invalid number'), ('missing_param', 'Missing parameter'), ('cancelled', 'Cancelled'),
]
RECIPIENT_STATES = [
    ('pending', 'Pending'), ('skipped', 'Skipped'), ('queued', 'Queued'), ('sent', 'Sent'), ('delivered', 'Delivered'),
    ('read', 'Read'), ('failed', 'Failed'),
]
FAILURES = [
    ('frequency_capped', 'Frequency capped'), ('marketing_opt_out', 'Marketing opt-out'), ('not_on_whatsapp', 'Not on WhatsApp'),
    ('template_unavailable', 'Template unavailable'), ('invalid_params', 'Invalid parameters'), ('experiment', 'Experiment'),
    ('account_restricted', 'Account restricted'), ('other', 'Other'),
]
PARAM_LOCATIONS = [('header', 'Header'), ('body', 'Body'), ('button', 'Button')]
PARAM_SOURCES = [
    ('static', 'Static text'), ('contact_name', 'Contact name'), ('contact_first_name', 'Contact first name'),
    ('contact_phone', 'Contact phone'), ('contact_email', 'Contact email'),
]
MARKETING_APIS = [('cloud_api', 'Cloud API'), ('marketing_messages', 'Marketing Messages API')]
MARKETING_ONBOARDINGS = [
    ('not_started', 'Not started'), ('eligible', 'Eligible'), ('onboarded', 'Onboarded'), ('unknown', 'Unknown'),
]
KEYWORD_KINDS = [('stop', 'Stop'), ('start', 'Start')]

# Unique customers per rolling day by messaging limit (None: unlimited). A portfolio without a known tier starts at 250.
TIER_CAPS = {'tier_50': 50, 'tier_250': 250, 'tier_2k': 2000, 'tier_10k': 10000, 'tier_100k': 100000, 'unlimited': None}
DEFAULT_TIER_CAP = 250
WHATSAPP_ADDRESS_DIGITS = (8, 15)
MAX_DAILY_CAP = 1_000_000
# WhatsApp keeps an uploaded media id for 30 days; it is uploaded again after this many.
MEDIA_MAX_AGE_DAYS = 25
DISPATCH_ATTEMPTS = 3
PREPARE_FAILURES = 3

DEFAULT_STOP_REPLY = 'تم إيقاف الرسائل الترويجية. لإعادة تفعيلها أرسل «تفعيل العروض».'
DEFAULT_START_REPLY = 'تم تفعيل الرسائل الترويجية من جديد.'
# Never «إلغاء» alone: it is a common word for cancelling an appointment.
DEFAULT_KEYWORDS = {
    'stop': ('إيقاف', 'إلغاء الاشتراك', 'إيقاف العروض', 'stop', 'unsubscribe', 'stop promotions'),
    'start': ('تفعيل العروض', 'start promotions'),
}
# The start words earlier versions seeded: ambiguous («اشتراك» is also a subscription request), so they are removed.
RETIRED_START_KEYWORDS = ('اشتراك', 'start', 'subscribe')


class Handling(NamedTuple):
    """What a Meta error code means for a campaign recipient.

    `failure`: the recipient's failure (None: the message never left, see `release`); `pause`: the reason the whole campaign
    pauses; `consent`: the customer stopped marketing; `release`: the recipient goes back to pending (after the pause, if any); `reupload`: the header media is uploaded again.
    """
    failure: str | None
    pause: str | None = None
    consent: bool = False
    release: bool = False
    # The uploaded header media is gone: the campaign uploads it again.
    reupload: bool = False


ERROR_HANDLING = {
    131049: Handling('frequency_capped'),
    131050: Handling('marketing_opt_out', consent=True),
    131026: Handling('not_on_whatsapp'),
    **dict.fromkeys((132001, 132015, 132016), Handling('template_unavailable', pause='template_unavailable')),
    **dict.fromkeys((132000, 132012, 132018, 131008, 131009), Handling('invalid_params')),
    130472: Handling('experiment'),
    **dict.fromkeys((131048, 131031, 368), Handling('account_restricted', pause='account_restricted')),
    131042: Handling(None, pause='payment', release=True),
    190: Handling(None, pause='token', release=True),
    131063: Handling(None, pause='template_unavailable', release=True),
    **dict.fromkeys((131052, 131053), Handling(None, release=True, reupload=True)),
}
