# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from odoo.addons.webvue_payments.models.access_service import PROVIDERS_MANAGE

MANAGER_GROUP = 'webvue_payments.group_cap_payments_providers_manage'


class PaymentProvider(models.Model):
    _inherit = 'payment.provider'

    # Stock restricts this key to system administrators. The tenant's own payments manager
    # enters it through WebVue, so the capability group joins the field group; the API only
    # ever reports whether it is set.
    paymob_secret_key = fields.Char(groups=f'base.group_system,{MANAGER_GROUP}')

    def _webvue_payments_definition(self):
        """The registry definition of this provider's code, or an empty dict when WebVue does not offer it."""
        self.ensure_one()
        return self.env['webvue.payments.provider.registry']._webvue_provider_map().get(self.code, {})

    def _webvue_payments_credentials_present(self):
        """``{field: bool}`` for each credential field: whether the tenant has entered it."""
        self.ensure_one()
        return {field: bool(self[field]) for field in self._webvue_payments_definition()['credential_fields']}

    def _webvue_payments_configured(self):
        return all(self._webvue_payments_credentials_present().values())

    def _webvue_payments_account_country(self):
        """The country code of the tenant's merchant account, or ``None`` when the gateway has none."""
        self.ensure_one()
        definition = self._webvue_payments_definition().get('account_country')
        return self[definition['field']].code if definition and self[definition['field']] else None

    def _webvue_payments_set_account_country(self, code):
        """Store the merchant account country; stock derives the provider currency from it."""
        self.ensure_one()
        definition = self._webvue_payments_definition()['account_country']
        country = self.env['res.country'].search([('code', '=', code)], limit=1)
        self.write({definition['field']: country.id})

    def _webvue_payments_ensure_account_country(self):
        """Give the merchant account its default country when the tenant has not chosen one."""
        self.ensure_one()
        definition = self._webvue_payments_definition().get('account_country')
        if definition and not self[definition['field']]:
            self._webvue_payments_set_account_country(definition['default'])

    def _webvue_payments_set_state(self, state):
        """Switch between ``disabled``, ``test`` and ``enabled``.

        A provider that is on is published in both modes: payers reach it only through WebVue's
        token-checked pay page, so a tenant can run a full test payment before going live.

        Stock ``write`` on a state change archives the provider's saved tokens, toggles its payment
        methods and the payment post-processing cron, all system-only models. The switch itself is
        elevated, after the caller's capability and the provider's company are checked here.
        """
        self.ensure_one()
        self.env['webvue.access.service']._webvue_require_capability(PROVIDERS_MANAGE)
        if self.company_id != self.env.company:
            raise AccessError(self.env._("This gateway belongs to another company."))
        self.sudo().write({'state': state, 'is_published': state != 'disabled'})

    def _webvue_payments_sync(self):
        """Check the stored keys against the gateway and prepare the account for the current mode.

        The stock Paymob action names the merchant's gateway integrations after the mode (test or
        live), so it must run again after every mode, key or country change.

        :return: ``'synced'``, or ``'methods_missing'`` when the account lacks a payment method
            the provider needs (stock then leaves the account unprepared).
        """
        self.ensure_one()
        notification = getattr(self, self._webvue_payments_definition()['sync_method'])()
        return 'methods_missing' if notification['params'].get('type') == 'warning' else 'synced'
