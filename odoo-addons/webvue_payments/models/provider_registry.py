# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.payment_paymob.const import API_MAPPING as PAYMOB_COUNTRIES


class WebVuePaymentsProviderRegistry(models.AbstractModel):
    """The gateways a tenant can connect, one definition per stock provider code.

    A provider addon adds its own definition by inheriting this model. ``credential_fields`` are
    the stock provider fields that hold the tenant's keys: they are written through the API and
    only their presence is ever read back. ``account_country`` is the stock field holding the
    country of the tenant's merchant account, its allowed country codes and the default.
    ``sync_method`` is the stock provider action that checks the keys against the gateway and
    prepares the account for the current mode. ``routes`` are the stock callback routes the
    gateway calls (``webhook``) and sends the payer back to (``return``); WebVue relays them to
    the stock controllers unchanged.
    """

    _name = 'webvue.payments.provider.registry'
    _description = 'WebVue payments provider registry'

    @api.model
    def _webvue_provider_definitions(self):
        return (
            {
                'code': 'paymob',
                'credential_fields': ('paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key'),
                'account_country': {
                    'field': 'paymob_account_country_id', 'codes': tuple(sorted(PAYMOB_COUNTRIES)), 'default': 'SA',
                },
                'sync_method': 'action_sync_paymob_payment_methods',
                'routes': {'webhook': '/payment/paymob/webhook', 'return': '/payment/paymob/return'},
            },
        )

    @api.model
    def _webvue_provider_map(self):
        return {item['code']: item for item in self._webvue_provider_definitions()}
