# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class WebVuePaymentsProviderRegistry(models.AbstractModel):
    """The gateways a tenant can connect, one definition per stock provider code.

    A provider addon adds its own definition by inheriting this model. ``credential_fields``
    are the stock provider fields that hold the tenant's keys: they are written through the API
    and never read back. ``defaults`` are stock fields WebVue fixes for every tenant, by xml id.
    ``sync_method`` is the stock provider action that checks the keys against the gateway.
    """

    _name = 'webvue.payments.provider.registry'
    _description = 'WebVue payments provider registry'

    @api.model
    def _webvue_provider_definitions(self):
        return (
            {
                'code': 'paymob',
                'credential_fields': ('paymob_public_key', 'paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key'),
                'defaults': {'paymob_account_country_id': 'base.sa'},
                'webhook_path': '/payment/paymob/webhook',
                'sync_method': 'action_sync_paymob_payment_methods',
            },
        )

    @api.model
    def _webvue_provider_map(self):
        return {item['code']: item for item in self._webvue_provider_definitions()}
