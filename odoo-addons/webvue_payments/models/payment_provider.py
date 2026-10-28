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

    def _webvue_payments_webhook_url(self):
        self.ensure_one()
        return self.get_base_url().rstrip('/') + self._webvue_payments_definition()['webhook_path']

    def _webvue_payments_apply_defaults(self):
        """Write the fixed WebVue values (e.g. the Paymob account country) that are still empty."""
        self.ensure_one()
        values = {
            field: self.env.ref(xmlid).id
            for field, xmlid in self._webvue_payments_definition()['defaults'].items()
            if not self[field]
        }
        if values:
            self.write(values)

    def _webvue_payments_set_state(self, state):
        """Switch between ``disabled``, ``test`` and ``enabled``; only a live provider is published.

        Stock ``write`` on a state change archives the provider's saved tokens, toggles its payment
        methods and the payment post-processing cron, all system-only models. The switch itself is
        elevated, after the caller's capability and the provider's company are checked here.
        """
        self.ensure_one()
        self.env['webvue.access.service']._webvue_require_capability(PROVIDERS_MANAGE)
        if self.company_id != self.env.company:
            raise AccessError(self.env._("This gateway belongs to another company."))
        self.sudo().write({'state': state, 'is_published': state == 'enabled'})

    def _webvue_payments_sync(self):
        """Check the stored keys against the gateway through the stock sync action.

        :return: ``'synced'`` when every enabled payment method was found on the account,
            ``'partial'`` when some were not.
        """
        self.ensure_one()
        notification = getattr(self, self._webvue_payments_definition()['sync_method'])()
        return 'partial' if notification['params'].get('type') == 'warning' else 'synced'
