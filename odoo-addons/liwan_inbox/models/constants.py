# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

CHANNELS_LIMIT = 'inbox.channels'
MESSAGES_OUT_LIMIT = 'inbox.messages_out'
WHATSAPP_FEATURE = 'inbox.whatsapp'
AUTOMATION_FEATURE = 'inbox.automation'
FLOWS_FEATURE = 'inbox.flows'
DEFAULT_TIMEZONE = 'Asia/Riyadh'

# WhatsApp customer-service window: free-form replies are accepted this long after the last inbound message.
REPLY_WINDOW = timedelta(hours=24)
PREVIEW_LENGTH = 140
MAX_ATTEMPTS = 5
BACKOFF_MINUTES = (1, 2, 4, 8, 16)
EVENT_BATCH = 200
OUTBOX_BATCH = 100
PROCESSED_EVENT_DAYS = 7

REPLY_PREVIEW_LENGTH = 80
# A conversation sends the typing indicator at most this often, and an upload nobody sent is deleted after a day.
TYPING_THROTTLE = timedelta(seconds=20)
STALE_UPLOAD_AGE = timedelta(days=1)
# A typing request older than this is dropped unsent: the customer would see "typing" long after the agent stopped.
TYPING_MAX_AGE = timedelta(seconds=25)
OUTBOX_CRON = 'liwan_inbox.ir_cron_inbox_send_outbox'

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
