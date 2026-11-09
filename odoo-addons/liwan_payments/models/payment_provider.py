# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_payments.models.access_service import PROVIDERS_MANAGE

MANAGER_GROUP = 'liwan_payments.group_cap_payments_providers_manage'
# The fields that authenticate the gateway itself. Stock cofines only the secret key to system
# administrators and leaves the HMAC and API keys readable by any role holding the model's ACL
# row, so that role could read the key that signs a payment notification and forge a settled
# transaction. All three are system-only here, and the payments manager touches none of them
# through the ORM (issue #512): it writes them through `_liwan_payments_set_credentials` and
# reads only their presence, both elevated after a capability check, and the API only ever
# reports whether each one is set.
SECRET_FIELDS = ('paymob_secret_key', 'paymob_hmac_key', 'paymob_api_key')


class PaymentProvider(models.Model):
    _inherit = 'payment.provider'

    # The secret key keeps stock's own definition (`groups='base.group_system'`). These two are
    # narrowed to the same group: they sign and authenticate the gateway exactly as it does.
    paymob_hmac_key = fields.Char(groups='base.group_system')
    paymob_api_key = fields.Char(groups='base.group_system')

    def _liwan_payments_definition(self):
        """The registry definition of this provider's code, or an empty dict when LiwanOS does not offer it."""
        self.ensure_one()
        return self.env['liwan.payments.provider.registry']._liwan_provider_map().get(self.code, {})

    def _liwan_payments_credentials_present(self):
        """``{field: bool}`` for each credential field: whether the tenant has entered it.

        The three secret fields are system-only, so the presence check reads them elevated: the
        answer is one boolean per key, never the value, and it is the only thing the API returns.
        """
        self.ensure_one()
        elevated = self.sudo()
        return {field: bool(elevated[field]) for field in self._liwan_payments_definition()['credential_fields']}

    def _liwan_payments_set_credentials(self, values):
        """Store the gateway's keys after the caller's capability check.

        The write is the only path into the three secret fields. It elevates because those fields
        are system-only, and it is reachable only from the providers controller, which requires
        ``payments.providers.manage`` and the current company before calling it (issue #512).
        """
        self.ensure_one()
        self.env['liwan.access.service']._liwan_require_capability(PROVIDERS_MANAGE)
        if self.company_id != self.env.company:
            raise AccessError(self.env._("This gateway belongs to another company."))
        self.sudo().write(values)
        return True

    def _liwan_payments_configured(self):
        return all(self._liwan_payments_credentials_present().values())

    def _liwan_payments_account_country(self):
        """The country code of the tenant's merchant account, or ``None`` when the gateway has none."""
        self.ensure_one()
        definition = self._liwan_payments_definition().get('account_country')
        return self[definition['field']].code if definition and self[definition['field']] else None

    def _liwan_payments_set_account_country(self, code):
        """Store the merchant account country; stock derives the provider currency from it."""
        self.ensure_one()
        definition = self._liwan_payments_definition()['account_country']
        country = self.env['res.country'].search([('code', '=', code)], limit=1)
        self.write({definition['field']: country.id})

    def _liwan_payments_ensure_account_country(self):
        """Give the merchant account its default country when the tenant has not chosen one."""
        self.ensure_one()
        definition = self._liwan_payments_definition().get('account_country')
        if definition and not self[definition['field']]:
            self._liwan_payments_set_account_country(definition['default'])

    def _liwan_payments_set_state(self, state):
        """Switch between ``disabled``, ``test`` and ``enabled``; only a live provider is published.

        As in stock, only a live gateway is offered to customers: a payment in test mode still
        posts and reconciles a real payment entry, so a test card must never settle a real invoice.

        Stock ``write`` on a state change archives the provider's saved tokens, toggles its payment
        methods and the payment post-processing cron, all system-only models. The switch itself is
        elevated, after the caller's capability and the provider's company are checked here.
        """
        self.ensure_one()
        self.env['liwan.access.service']._liwan_require_capability(PROVIDERS_MANAGE)
        if self.company_id != self.env.company:
            raise AccessError(self.env._("This gateway belongs to another company."))
        self.sudo().write({'state': state, 'is_published': state == 'enabled'})

    def _toggle_post_processing_cron(self):
        """Keep the payment post-processing cron on while a transaction still waits for it.

        Stock switches the cron off with the last active gateway, but money that arrives after
        that (a payer who was already on the gateway page) or a post-processing that failed must
        still be confirmed, recorded and reconciled; the cron is the durable retry.
        """
        super()._toggle_post_processing_cron()
        cron = self.env.ref('payment.cron_post_process_payment_tx', raise_if_not_found=False)
        if cron and not cron.active and self.env['payment.transaction'].search_count(
            [('state', 'in', ('authorized', 'done')), ('is_post_processed', '=', False)], limit=1,
        ):
            cron.active = True

    def _liwan_payments_sync(self):
        """Check the stored keys against the gateway and prepare the account for the current mode.

        The stock Paymob action names the merchant's gateway integrations after the mode (test or
        live), so it must run again after every mode, key or country change.

        The stock code reads the gateway's keys to authenticate itself, and those fields are
        system-only (issue #512), so the check runs elevated after the caller's capability is
        verified by the controller. Nothing of the keys is returned or logged.

        :return: ``'synced'``, or ``'methods_missing'`` when the account lacks a payment method
            the provider needs (stock then leaves the account unprepared).
        """
        self.ensure_one()
        elevated = self.sudo()
        notification = getattr(elevated, elevated._liwan_payments_definition()['sync_method'])()
        return 'methods_missing' if notification['params'].get('type') == 'warning' else 'synced'
