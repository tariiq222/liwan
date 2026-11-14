# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

PAYMENTS_SETTINGS_PATH = '/settings/apps/payments#providers'
GATEWAY_USE = 'payments.gateway'
OWNER = 'liwan_integrations_payments'


class LiwanPaymentsIntegrationRegistry(models.AbstractModel):
    """Each payment gateway of the payments registry as an external provider: payments owns the keys and the state."""
    _inherit = 'liwan.integration.registry'

    @api.model
    def _liwan_payment_gateway_codes(self):
        return tuple(self.env['liwan.payments.provider.registry']._liwan_provider_map())

    @api.model
    def _liwan_provider_definitions(self):
        return super()._liwan_provider_definitions() + tuple(
            {
                'code': code, 'owner': OWNER, 'auth': 'external',
                'secrets': (), 'generated_secrets': (), 'attributes': (), 'webhook_secrets': (), 'settings_path': PAYMENTS_SETTINGS_PATH,
                'exclusive': False,
            }
            for code in self._liwan_payment_gateway_codes()
        )

    @api.model
    def _liwan_use_definitions(self):
        return super()._liwan_use_definitions() + tuple(
            {
                'key': f'{GATEWAY_USE}.{code}',
                'provider': code, 'owner': OWNER, 'feature_key': 'payments.enabled', 'scopes': (), 'webhook_path': None,
            }
            for code in self._liwan_payment_gateway_codes()
        )

    @api.model
    def _liwan_external_status(self, code, company):
        """``not_configured`` without every credential, ``pending`` while the gateway is disabled, else ``connected``.

        The provider row is system-only in stock, and any ``integrations.read`` holder sees the true state, so the
        row is read elevated; the answer is a state and a short message, never a key or its presence per field.
        """
        if code not in self._liwan_payment_gateway_codes():
            return super()._liwan_external_status(code, company)
        provider = self.env['payment.provider'].sudo().search([('code', '=', code), ('company_id', '=', company.id)], limit=1)
        if not provider or not provider._liwan_payments_configured():
            return {'state': 'not_configured', 'status_message': '', 'last_checked': None}
        if provider.state == 'disabled':
            return {'state': 'pending', 'status_message': self.env._('Keys saved, gateway disabled'), 'last_checked': None}
        message = self.env._('Gateway in test mode') if provider.state == 'test' else self.env._('Gateway live')
        return {'state': 'connected', 'status_message': message, 'last_checked': None}
