# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

from odoo.addons.webvue_inbox.models.campaign_constants import (
    DEFAULT_KEYWORDS,
    DEFAULT_START_REPLY,
    DEFAULT_STOP_REPLY,
)


def migrate(cr, version):
    """Give the settings of every company that exists before the campaigns the default stop and start keywords and replies."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    for settings in env['webvue.inbox.settings'].search([]):
        settings._webvue_add_keywords({kind: list(words) for kind, words in DEFAULT_KEYWORDS.items()})
        settings.write({
            'stop_reply': settings.stop_reply or DEFAULT_STOP_REPLY, 'start_reply': settings.start_reply or DEFAULT_START_REPLY,
        })
