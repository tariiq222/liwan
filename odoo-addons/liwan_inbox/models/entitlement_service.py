# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .constants import CAMPAIGN_RECIPIENTS_LIMIT, CHANNELS_LIMIT


class LiwanInboxEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_count_usage(self, limit_key):
        if limit_key == CHANNELS_LIMIT:
            return self._liwan_count_channels()
        if limit_key == CAMPAIGN_RECIPIENTS_LIMIT:
            return self.env['liwan.inbox.campaign.recipient']._liwan_count_dispatched_this_month()
        return super()._liwan_count_usage(limit_key)

    @api.model
    def _liwan_count_channels(self):
        self.env.cr.execute('SELECT count(*) FROM liwan_inbox_channel')
        return self.env.cr.fetchone()[0]

    @api.model
    def _liwan_claim_channels(self, delta):
        return self._liwan_claim(CHANNELS_LIMIT, self._liwan_count_channels(), delta)
