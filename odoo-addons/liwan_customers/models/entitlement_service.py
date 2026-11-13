# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Derived, never registered: it tells the web client whether the customers routes are open for this tenant.
CUSTOMERS_ENABLED = 'customers.enabled'


class LiwanCustomersEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_readable_features(self, profile=None):
        keys = super()._liwan_readable_features(profile)
        return self._liwan_with_customers_enabled(keys)

    @api.model
    def _liwan_writable_features(self, profile=None):
        keys = super()._liwan_writable_features(profile)
        return self._liwan_with_customers_enabled(keys)

    @api.model
    def _liwan_with_customers_enabled(self, keys):
        """``keys`` plus ``customers.enabled`` (still sorted) when one of the feature keys that applications
        registered for the customers service is among them: the same rule the routes' registered-feature gate applies."""
        registered = set(self.env['liwan.customers.service']._liwan_customers_feature_keys())
        if registered.intersection(keys):
            return tuple(sorted({*keys, CUSTOMERS_ENABLED}))
        return keys
