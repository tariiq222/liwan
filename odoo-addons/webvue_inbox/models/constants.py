# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

CHANNELS_LIMIT = 'inbox.channels'
MESSAGES_OUT_LIMIT = 'inbox.messages_out'
WHATSAPP_FEATURE = 'inbox.whatsapp'

# WhatsApp customer-service window: free-form replies are accepted this long after the last inbound message.
REPLY_WINDOW = timedelta(hours=24)
PREVIEW_LENGTH = 140
MAX_ATTEMPTS = 5
BACKOFF_MINUTES = (1, 2, 4, 8, 16)
EVENT_BATCH = 200
OUTBOX_BATCH = 100
PROCESSED_EVENT_DAYS = 7
