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

REPLY_PREVIEW_LENGTH = 80
# A conversation sends the typing indicator at most this often, and an upload nobody sent is deleted after a day.
TYPING_THROTTLE = timedelta(seconds=20)
STALE_UPLOAD_AGE = timedelta(days=1)
# A typing request older than this is dropped unsent: the customer would see "typing" long after the agent stopped.
TYPING_MAX_AGE = timedelta(seconds=25)
OUTBOX_CRON = 'webvue_inbox.ir_cron_inbox_send_outbox'
