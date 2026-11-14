# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, models

# Derived, never registered: it tells the web client whether the customers routes are open for this tenant.
CUSTOMERS_ENABLED = 'customers.enabled'
# Taking a copy of one person's data is a read (PDPL access right): it stays open while the tenant is read-only. The erase
# and its preview (which issues the token for a write) stay refused.
SUBJECT_EXPORT_PATH = re.compile(r'/api/v1/customers/\d+/privacy/export')
# The log row of that export is the bookkeeping of the read, like the tenant export's own job row.
PRIVACY_LOG_MODEL = 'liwan.customers.privacy.request'


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

    @api.model
    def _liwan_api_write_allowed(self, path):
        return bool(SUBJECT_EXPORT_PATH.fullmatch(path)) or super()._liwan_api_write_allowed(path)

    @api.model
    def _liwan_read_only_allowances(self):
        allowances = super()._liwan_read_only_allowances()
        return {**allowances, 'plumbing': allowances['plumbing'] | {PRIVACY_LOG_MODEL}}
