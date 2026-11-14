# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Derived, never registered: it tells the web client whether the products routes are open for this tenant.
PRODUCTS_ENABLED = 'products.enabled'


class LiwanProductsEntitlementService(models.AbstractModel):
    _inherit = 'liwan.entitlement.service'

    @api.model
    def _liwan_readable_features(self, profile=None):
        keys = super()._liwan_readable_features(profile)
        return self._liwan_with_products_enabled(keys)

    @api.model
    def _liwan_writable_features(self, profile=None):
        keys = super()._liwan_writable_features(profile)
        return self._liwan_with_products_enabled(keys)

    @api.model
    def _liwan_with_products_enabled(self, keys):
        """``keys`` plus ``products.enabled`` (still sorted) when one of the feature keys that applications registered
        for the products service is among them: the same rule the routes' registered-feature gate applies."""
        registered = set(self.env['liwan.products.service']._liwan_products_feature_keys())
        if registered.intersection(keys):
            return tuple(sorted({*keys, PRODUCTS_ENABLED}))
        return keys
