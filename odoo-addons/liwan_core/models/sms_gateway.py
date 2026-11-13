# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import os

import requests

from odoo import api, models
from odoo.exceptions import ValidationError
from odoo.modules import module

_logger = logging.getLogger(__name__)

# The SMS provider is chosen by the operator, never by a tenant: ``liwan.login.sms.provider`` names it, and an
# empty value means Authentica when its credentials are present in the server environment, else no provider.
# ``simulator`` is the development and test implementation of the same interface and is refused in production.
PROVIDER_PARAM = 'liwan.login.sms.provider'
SIMULATOR = 'simulator'
AUTHENTICA = 'authentica'
# Authentica credentials are operator configuration in the server environment of the Odoo process: one account
# for every tenant on shared hosting, the customer's own account on customer-hosted deployments. They are never
# an ``ir.config_parameter`` (a tenant database row) and never leave this module.
AUTHENTICA_KEY_ENV = 'LIWAN_AUTHENTICA_API_KEY'
AUTHENTICA_TEMPLATE_ENV = 'LIWAN_AUTHENTICA_TEMPLATE_ID'
AUTHENTICA_ENDPOINT = 'https://api.authentica.sa/api/v2/send-otp'
# Connect and read seconds. The call is made once: a retry after a read timeout could deliver two codes.
AUTHENTICA_TIMEOUT = (3, 5)


class SmsDeliveryError(Exception):
    """The provider did not accept the code. It carries no detail: a provider answer can echo the number or the key."""


class LiwanSmsGateway(models.AbstractModel):
    """The delivery of a sign-in code: one seam (``_liwan_send``), email through the tenant's mail server,
    and SMS through the one configured provider, or the simulator outside production.

    For SMS the message is the bare code: the provider's approved template supplies the wording. A provider
    that is a separate addon is added by naming it in ``_liwan_providers`` and handling it in ``_liwan_send``;
    ``super()`` keeps the other channels working.
    """
    _name = 'liwan.sms.gateway'
    _description = 'LiwanOS sign-in delivery gateway'
    _liwan_scope = 'global'

    @api.model
    def _liwan_provider(self):
        """The configured SMS provider, or ''.

        It is read through the cached ``_get_param`` accessor, as ``liwan.outbound.mail`` reads the sender,
        because the caller of a sign-in code is the pre-authenticated (or public) user of the login page.
        It returns a provider name, never a credential; ``_liwan_send`` decides what that name may do.
        """
        configured = (self.env['ir.config_parameter']._get_param(PROVIDER_PARAM) or '').strip().lower()
        if configured:
            return configured
        return AUTHENTICA if self._liwan_authentica_config() else ''

    @api.model
    def _liwan_providers(self):
        """The SMS providers this addon implements; an addon with a vendor adapter extends this."""
        return (SIMULATOR, AUTHENTICA)

    @api.model
    def _liwan_is_production(self):
        # A test run is never production, so no test needs a real provider (as the mobile gate does).
        return not module.current_test

    @api.model
    def _liwan_authentica_config(self):
        """``(api key, template id)`` from the server environment, or None until both are set and well formed."""
        key = os.environ.get(AUTHENTICA_KEY_ENV, '').strip()
        template = os.environ.get(AUTHENTICA_TEMPLATE_ENV, '').strip()
        return (key, int(template)) if key and template.isascii() and template.isdigit() else None

    @api.model
    def _liwan_sms_available(self):
        """Whether the SMS channel may be offered: a configured provider, or the simulator outside production."""
        provider = self._liwan_provider() or SIMULATOR
        if provider not in self._liwan_providers():
            return False
        if provider == AUTHENTICA:
            return self._liwan_authentica_config() is not None
        return not self._liwan_is_production()

    @api.model
    def _liwan_send(self, channel, destination, body):
        """Deliver BODY to DESTINATION over CHANNEL; refuse SMS when no provider is configured.

        BODY is the message for email and the bare code for SMS. A provider that refuses or times out raises
        :class:`SmsDeliveryError`; the caller turns it into a channel the user can replace with email.
        """
        if channel == 'email':
            self.env['liwan.account.mail']._liwan_send_code(destination, body)
        elif channel == 'sms':
            if not self._liwan_sms_available():
                msg = 'channel_unavailable'
                raise ValidationError(msg)
            if (self._liwan_provider() or SIMULATOR) == AUTHENTICA:
                self._liwan_send_authentica(destination, body)
            else:
                _logger.info('liwan sms simulator (%s characters): no provider configured', len(body))
        else:
            msg = 'invalid_channel'
            raise ValidationError(msg)

    @api.model
    def _liwan_send_authentica(self, mobile, code):
        """Send OUR code through Authentica's template once.

        The ``otp`` field makes Authentica deliver the code Odoo generated and verifies locally, so there is one
        source of truth. The approved template must accept a caller-supplied OTP. Nothing the provider answers
        is logged: only the failure class and the HTTP status.
        """
        key, template_id = self._liwan_authentica_config()
        try:
            response = requests.post(
                AUTHENTICA_ENDPOINT,
                json={'method': 'sms', 'phone': mobile, 'otp': code, 'template_id': template_id},
                headers={'X-Authorization': key, 'Accept': 'application/json'},
                timeout=AUTHENTICA_TIMEOUT,
                allow_redirects=False,
            )
            acknowledged = response.ok and response.json().get('success') is True
        except (requests.RequestException, ValueError, AttributeError) as error:
            _logger.warning('liwan sms authentica: delivery failed (%s)', type(error).__name__)
            raise SmsDeliveryError from None
        if not acknowledged:
            _logger.warning('liwan sms authentica: delivery refused (HTTP %s)', response.status_code)
            raise SmsDeliveryError
