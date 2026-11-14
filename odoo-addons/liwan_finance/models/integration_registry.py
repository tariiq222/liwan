# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from odoo.addons.liwan_finance.serializers.zatca import dump_zatca_readiness

ZATCA_PROVIDER = 'zatca'
ZATCA_SETTINGS_PATH = '/settings/apps/finance#zatca'


class LiwanFinanceIntegrationRegistry(models.AbstractModel):
    """ZATCA in the integrations service: an external provider whose status finance derives from its journals."""
    _inherit = 'liwan.integration.registry'

    @api.model
    def _liwan_provider_definitions(self):
        return super()._liwan_provider_definitions() + (
            {
                'code': ZATCA_PROVIDER, 'owner': 'liwan_finance', 'auth': 'external',
                'secrets': (), 'generated_secrets': (), 'attributes': (), 'settings_path': ZATCA_SETTINGS_PATH,
                'exclusive': False,
            },
        )

    @api.model
    def _liwan_use_definitions(self):
        return super()._liwan_use_definitions() + (
            {
                'key': 'finance.zatca', 'provider': ZATCA_PROVIDER, 'owner': 'liwan_finance',
                'feature_key': 'finance.enabled', 'scopes': (), 'webhook_path': None,
            },
        )

    @api.model
    def _liwan_external_status(self, code, company):
        """ZATCA status of ``company``: none, some or all of its sales journals onboarded.

        Every ``integrations.read`` holder sees the true state, so the readiness is read elevated; the answer
        carries only the state and the count message, no journal data.
        """
        if code != ZATCA_PROVIDER:
            return super()._liwan_external_status(code, company)
        readiness = dump_zatca_readiness(company.sudo())
        total = len(readiness['journals'])
        done = sum(row['onboarded'] for row in readiness['journals'])
        state = 'connected' if total and done == total else 'pending' if done else 'not_configured'
        message = f'ZATCA {readiness["api_mode"]}: {done} of {total} sales journals onboarded' if done else ''
        return {'state': state, 'status_message': message, 'last_checked': None}
