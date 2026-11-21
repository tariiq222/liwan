# Part of Odoo. See LICENSE file for full copyright and licensing details.
import phonenumbers

from odoo import api, models

from .messaging import refuse
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.providers import errors


class LiwanIntegrationLookup(models.AbstractModel):
    """The one entry point to validate a phone number with the company's provider connection.

    Like ``liwan.integration.voice`` it keeps its elevation inside and returns plain data. It stores
    nothing: every answer goes back to the caller only, and it has no daily limit yet (D6) — the first
    application that uses lookup brings its own.
    """
    _name = 'liwan.integration.lookup'
    _description = 'LiwanOS lookup service'
    _liwan_scope = 'global'

    @api.model
    def _liwan_lookup(self, number, line_type=False):
        """``{'valid', 'e164', 'country', 'line_type'}`` of ``number``, or a refusal.

        ``line_type`` is asked from the provider (and returned non-null) only when requested: it is a
        billed package. A refused or unreachable provider answers ``lookup_failed``.
        """
        company = self.env.company
        connection = self.env['liwan.integration.connection'].search([
            ('company_id', '=', company.id), ('provider', 'in', self._liwan_lookup_providers()), ('state', '=', 'connected'),
        ], limit=1)
        if not connection:
            refuse('no_connection', self.env._('Connect a provider account that can look up numbers first.'), field='connection_id')
        use = connection._liwan_use(f'{connection.provider}.lookup')
        self.env['liwan.entitlement.service'].require_read(use['feature_key'])
        e164 = self._liwan_normalize(number, company)
        try:
            answer = providers.MODULES[connection.provider].lookup(
                connection.external_id, connection._liwan_provider_credentials(), e164, line_type=line_type,
            )
        except errors.ProviderError as error:
            refuse('lookup_failed', self.env._('The provider could not look the number up: %(message)s', message=error), status=502)
        return {
            'valid': answer['valid'],
            'e164': answer['e164'] or e164,
            'country': answer['country'],
            'line_type': answer['line_type'] if line_type else None,
        }

    @api.model
    def _liwan_lookup_providers(self):
        """The provider codes whose modules implement ``lookup``."""
        return tuple(code for code, module in providers.MODULES.items() if callable(getattr(module, 'lookup', None)))

    @api.model
    def _liwan_normalize(self, number, company):
        """``number`` as E.164; a local number is read in the company's country."""
        region = company.country_id.code or None
        try:
            parsed = phonenumbers.parse(number, region) if isinstance(number, str) and number.strip() else None
        except phonenumbers.NumberParseException:
            parsed = None
        if not parsed:
            refuse('invalid_phone', self.env._('The phone number is not valid.'), field='number')
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
