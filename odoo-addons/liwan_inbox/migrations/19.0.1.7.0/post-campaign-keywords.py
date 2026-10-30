# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_inbox.models.campaign_constants import (
    DEFAULT_KEYWORDS,
    DEFAULT_START_REPLY,
    DEFAULT_STOP_REPLY,
    RETIRED_START_KEYWORDS,
)
from odoo.addons.liwan_inbox.models.normalization import normalize_text

RETIRED_NORMALIZED = {normalize_text(word) for word in RETIRED_START_KEYWORDS}
RETIRED_STOP_REPLY = 'تم إيقاف الرسائل الترويجية. لإعادة تفعيلها أرسل «اشتراك».'


def migrate(cr, version):
    """Give the settings of every company that exists before the campaigns the default keywords and replies, and drop the retired start words."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for settings in env['liwan.inbox.settings'].search([]):
        settings._liwan_keywords('start').filtered(lambda keyword: keyword.normalized in RETIRED_NORMALIZED).unlink()
        settings._liwan_add_keywords({kind: list(words) for kind, words in DEFAULT_KEYWORDS.items()})
        stop_reply = settings.stop_reply if settings.stop_reply != RETIRED_STOP_REPLY else False
        settings.write({'stop_reply': stop_reply or DEFAULT_STOP_REPLY, 'start_reply': settings.start_reply or DEFAULT_START_REPLY})
