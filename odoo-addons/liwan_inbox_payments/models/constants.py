# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import timedelta

CATALOG_FEATURE = 'inbox.catalog'
SYNC_CRON = 'liwan_inbox_payments.ir_cron_inbox_catalog_sync'
RETAILER_ID = re.compile(r'^[A-Za-z0-9._-]{1,100}$')
META_ID = re.compile(r'^\d{5,32}$')
MAX_BRAND = 100
MAX_PRODUCT_NAME = 150
MAX_PRODUCT_DESCRIPTION = 5000
MIN_IMAGE_SIDE = 500
MAX_IMAGE_BYTES = 5 * 1024 * 1024
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
