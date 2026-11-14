# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Derived, never registered: it tells the web client that the company settings tax section exists.
COMPANY_TAX_ENABLED = 'company_tax.enabled'


class LiwanCompanyTaxEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_readable_features(self, profile=None):
        return tuple(sorted({*super()._liwan_readable_features(profile), COMPANY_TAX_ENABLED}))

    @api.model
    def _liwan_writable_features(self, profile=None):
        keys = super()._liwan_writable_features(profile)
        profile = profile or self._liwan_profile()
        if self._liwan_effective_state(profile) != 'active':
            return keys
        return tuple(sorted({*keys, COMPANY_TAX_ENABLED}))
