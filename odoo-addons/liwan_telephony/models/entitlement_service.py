# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .feature_registry import EXTENSIONS_LIMIT


class LiwanTelephonyEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_count_usage(self, limit_key):
        if limit_key == EXTENSIONS_LIMIT:
            return self._liwan_count_extensions()
        return super()._liwan_count_usage(limit_key)

    @api.model
    def _liwan_count_extensions(self):
        self.env['liwan.telephony.extension'].flush_model(['active'])
        self.env.cr.execute('SELECT count(*) FROM liwan_telephony_extension WHERE active IS TRUE')
        return self.env.cr.fetchone()[0]

    @api.model
    def _liwan_claim_extensions(self, delta):
        """Claim DELTA extension slots, counting the tenant's extensions under the profile lock.

        The tenant profile row is locked before the count: two concurrent creates cannot both read the last free
        slot. The lock ``_liwan_claim`` takes again on the same row in the same transaction is a no-op.
        """
        current = 0
        if delta > 0:
            self._liwan_profile()._liwan_lock()
            current = self._liwan_count_extensions()
        return self._liwan_claim(EXTENSIONS_LIMIT, current, delta)

    @api.model
    def _liwan_read_only_allowances(self):
        # Listening to a recording writes the listener's own audit row (create-only via ACLs); a read-only user,
        # read-only branch or payment-suspended tenant with read permission may still play recordings.
        allowances = super()._liwan_read_only_allowances()
        return {**allowances, 'own': allowances['own'] | {'liwan.telephony.recording.access'}}
