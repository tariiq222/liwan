# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .constants import CAMPAIGN_RECIPIENTS_LIMIT, CHANNELS_LIMIT


class WebVueInboxEntitlementService(models.AbstractModel):
    _inherit = 'webvue.entitlement.service'

    @api.model
    def _webvue_count_usage(self, limit_key):
        if limit_key == CHANNELS_LIMIT:
            return self._webvue_count_channels()
        if limit_key == CAMPAIGN_RECIPIENTS_LIMIT:
            return self.env['webvue.inbox.campaign.recipient']._webvue_count_dispatched_this_month()
        return super()._webvue_count_usage(limit_key)

    @api.model
    def _webvue_count_channels(self):
        self.env.cr.execute('SELECT count(*) FROM webvue_inbox_channel')
        return self.env.cr.fetchone()[0]

    @api.model
    def _webvue_claim_channels(self, delta):
        return self._webvue_claim(CHANNELS_LIMIT, self._webvue_count_channels(), delta)
