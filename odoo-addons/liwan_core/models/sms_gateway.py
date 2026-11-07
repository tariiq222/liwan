# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, models
from odoo.exceptions import ValidationError
from odoo.modules import module

_logger = logging.getLogger(__name__)

# The SMS provider the operator configures. The owner has not chosen one yet, so no vendor API is
# implemented: a production deployment without a provider refuses SMS and the sign-in screen offers
# email only. ``simulator`` is the development and test implementation of the same interface.
PROVIDER_PARAM = 'liwan.login.sms.provider'
SIMULATOR = 'simulator'


class LiwanSmsGateway(models.AbstractModel):
    """The delivery of a sign-in code: one seam (``_liwan_send``), email through the tenant's mail server,
    and SMS through the one configured provider, or the simulator outside production.

    A real provider is added by naming it in ``_liwan_providers`` and handling it in ``_liwan_send``;
    ``super()`` keeps the other channels working. Until then no vendor API is guessed.
    """
    _name = 'liwan.sms.gateway'
    _description = 'LiwanOS sign-in delivery gateway'
    _liwan_scope = 'global'

    @api.model
    def _liwan_provider(self):
        """The configured SMS provider, or ''.

        ``ir.config_parameter`` is readable by ``group_system`` only, and a sign-in code runs for the
        pre-authenticated (or public) user of the login page, so the one parameter read is elevated.
        It returns a provider name, never a credential; ``_liwan_send`` decides what that name may do.
        """
        return (self.env['ir.config_parameter'].sudo().get_param(PROVIDER_PARAM) or '').strip().lower()

    @api.model
    def _liwan_providers(self):
        """The SMS providers this addon implements; an addon with a vendor adapter extends this."""
        return (SIMULATOR,)

    @api.model
    def _liwan_is_production(self):
        # A test run is never production, so no test needs a real provider (as the mobile gate does).
        return not module.current_test

    @api.model
    def _liwan_sms_available(self):
        """Whether the SMS channel may be offered: an implemented provider, or the simulator outside production."""
        provider = self._liwan_provider() or SIMULATOR
        if provider not in self._liwan_providers():
            return False
        return provider != SIMULATOR or not self._liwan_is_production()

    @api.model
    def _liwan_send(self, channel, destination, body):
        """Deliver BODY to DESTINATION over CHANNEL; refuse SMS when no provider is configured."""
        if channel == 'email':
            self.env['liwan.account.mail']._liwan_send_code(destination, body)
        elif channel == 'sms':
            if not self._liwan_sms_available():
                msg = 'channel_unavailable'
                raise ValidationError(msg)
            _logger.info('liwan sms simulator (%s characters): no provider configured', len(body))
        else:
            msg = 'invalid_channel'
            raise ValidationError(msg)
