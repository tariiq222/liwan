# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import timedelta

INBOX_FEATURE = 'inbox.enabled'
CHANNELS_LIMIT = 'inbox.channels'
MESSAGES_OUT_LIMIT = 'inbox.messages_out'
WHATSAPP_FEATURE = 'inbox.whatsapp'
TIKTOK_FEATURE = 'inbox.tiktok'
# The sub-feature that gates one channel kind, checked on the channel create and on its routes.
CHANNEL_FEATURES = {'whatsapp': WHATSAPP_FEATURE, 'tiktok': TIKTOK_FEATURE}
# The channel kinds whose contact address is the number the provider authenticated: a WhatsApp id is the sender's phone,
# while a TikTok id is an opaque account id.
AUTHENTICATED_KINDS = ('whatsapp',)
# The public webhook path of each channel kind: the source of the uses' `webhook_path` and of the web proxy's route list.
HOOK_PATHS = {'whatsapp': '/api/v1/inbox/hooks/whatsapp', 'tiktok': '/api/v1/inbox/hooks/tiktok'}
# The uses of liwan.integration.registry that a channel of each kind holds (provider `meta` and `tiktok`).
CHANNEL_USES = {'whatsapp': 'inbox.whatsapp', 'tiktok': 'inbox.tiktok'}
# A TikTok event this young waits one cron run: the outbox may not have stored its provider message id yet, so
# its own send would look like a message from another client and be stored twice (D6).
TIKTOK_ECHO_SETTLE = timedelta(seconds=30)
# The scopes a TikTok connection must have granted for a channel to work.
TIKTOK_REQUIRED_SCOPES = ('message.list.read', 'message.list.send', 'user.info.basic')
AUTOMATION_FEATURE = 'inbox.automation'
TEMPLATES_FEATURE = 'inbox.templates'
FLOWS_FEATURE = 'inbox.flows'
DEFAULT_TIMEZONE = 'Asia/Riyadh'

# A customer-service window: free-form replies are accepted this long after the last inbound message, by kind.
REPLY_WINDOWS = {'whatsapp': timedelta(hours=24), 'tiktok': timedelta(hours=48)}
# TikTok also limits one sender to this many messages in a row before the customer writes again.
TIKTOK_MAX_REPLIES = 10
PREVIEW_LENGTH = 140
MAX_ATTEMPTS = 5
BACKOFF_MINUTES = (1, 2, 4, 8, 16)
EVENT_BATCH = 200
OUTBOX_BATCH = 100
PROCESSED_EVENT_DAYS = 7
# The most rows one maintenance pass deletes per query: a purge is bounded, and the next run continues where it stopped.
PURGE_BATCH = 500

REPLY_PREVIEW_LENGTH = 80
# A conversation sends the typing indicator at most this often, and an upload nobody sent is deleted after a day.
TYPING_THROTTLE = timedelta(seconds=20)
STALE_UPLOAD_AGE = timedelta(days=1)
# A typing request older than this is dropped unsent: the customer would see "typing" long after the agent stopped.
TYPING_MAX_AGE = timedelta(seconds=25)
OUTBOX_CRON = 'liwan_inbox.ir_cron_inbox_send_outbox'
EVENT_CRON = 'liwan_inbox.ir_cron_inbox_process_events'

# Automation guards: automated replies per conversation per hour, and how long an agent's reply keeps rule replies quiet.
MAX_AUTOMATED_PER_HOUR = 5
AGENT_ACTIVE_WINDOW = timedelta(minutes=10)
AUTOMATED_RATE_WINDOW = timedelta(hours=1)
FIRST_RESPONSE_CRON_BATCH = 200

# The survey's answers: (option id of the reply button, channel field holding its label, score stored on the conversation).
CSAT_OPTIONS = (('csat_good', 'csat_good', 'good'), ('csat_neutral', 'csat_neutral', 'neutral'), ('csat_bad', 'csat_bad', 'bad'))
CSAT_SCORES = {option_id: score for option_id, _label_field, score in CSAT_OPTIONS}

# WhatsApp Flows: the Flow JSON version the generator writes (Meta's recommended one) and the largest form LiwanOS builds.
FLOW_JSON_VERSION = '7.3'
MAX_FLOW_SCREENS = 10
MAX_FLOW_OPTIONS = 1000
# Campaigns (phase 4): the sub-feature, the monthly recipients limit and the dispatcher cron.
CAMPAIGNS_FEATURE = 'inbox.campaigns'
CAMPAIGN_RECIPIENTS_LIMIT = 'inbox.campaign_recipients'
CAMPAIGN_CRON = 'liwan_inbox.ir_cron_inbox_campaigns'
# Queued campaign messages the outbox may hold per campaign, and the contacts one snapshot step freezes.
CAMPAIGN_IN_FLIGHT = 200
SNAPSHOT_CHUNK = 1000
# Meta counts unique customers messaged outside a service window over a rolling day.
ROLLING_DAY = timedelta(hours=24)
REPLY_ATTRIBUTION = timedelta(hours=72)
UNSUBSCRIBE_ATTRIBUTION = timedelta(days=7)
FREQUENCY_RETRY_AFTER = timedelta(hours=24)

# What a message carries; the kind of a conversation's last message uses the same list.
MESSAGE_KINDS = [
    ('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('audio', 'Audio'), ('document', 'Document'),
    ('sticker', 'Sticker'), ('location', 'Location'), ('contacts', 'Contacts'), ('interactive', 'Interactive'),
    ('template', 'Template'), ('flow_response', 'Form answer'), ('product', 'Product'), ('product_list', 'Product list'),
    ('catalog_message', 'Catalog'), ('order', 'Order'), ('unsupported', 'Unsupported'),
]

# The product catalog (Meta commerce): the sub-feature, its sync cron and the limits Meta sets on an item.
CATALOG_FEATURE = 'inbox.catalog'
SYNC_CRON = 'liwan_inbox.ir_cron_inbox_catalog_sync'
RETAILER_ID = re.compile(r'^[A-Za-z0-9._-]{1,100}$')
META_ID = re.compile(r'^\d{5,32}$')
MAX_BRAND = 100
MAX_PRODUCT_NAME = 150
MAX_PRODUCT_DESCRIPTION = 5000
MIN_IMAGE_SIDE = 500
MAX_CART_QUANTITY = 99
IMAGE_PATH = '/api/v1/public/inbox/catalog/images'
# Meta's commerce settings of a phone number are re-read at most this often.
SETTINGS_REFRESH = timedelta(minutes=10)
# An item pushed to Meta whose batch never answers is marked failed after this long.
SYNC_TIMEOUT = timedelta(hours=1)
# Review states are re-read every run while open, and for settled items once a day.
REVIEW_REFRESH = timedelta(days=1)
PAY_BUTTON_TEXT = 'ادفع الآن'
PAID_NOTICE_TEXT = 'تم استلام دفعتك لطلب {reference}. شكرًا لك'
