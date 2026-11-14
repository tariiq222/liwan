# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The oauth part of a connection: operator app keys, the stored grant and its refresh under a row lock."""
import os

from odoo import fields, models
from odoo.tools import SQL

from .constants import TOKEN_MARGIN
from .errors import ReconnectRequired
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.providers import errors


class LiwanIntegrationConnectionOAuth(models.Model):
    _inherit = 'liwan.integration.connection'

    def _liwan_oauth_config(self):
        """The operator's app keys of this provider (environment); 422 `integration_not_configured` without them."""
        return self._liwan_oauth_config_of(self.provider)

    def _liwan_oauth_config_of(self, provider):
        config = providers.MODULES[provider].app_config(os.environ)
        if config is None:
            code = 'integration_not_configured'
            message = self.env._('The %(provider)s app is not configured.', provider=provider)
            raise LiwanAccessRule(code, message, details={'reason': code, 'provider': provider})
        return config

    def _liwan_oauth_values(self, grant):
        """The scalar columns of one grant: its scopes and both deadlines."""
        return {
            'scopes': ' '.join(sorted(grant.scopes)),
            'token_expires_at': grant.expires_at,
            'refresh_expires_at': grant.refresh_expires_at,
        }

    def _liwan_oauth_store(self, grant, label=None):
        """Store one authorization (tokens encrypted) and mark the account connected.

        This re-enables a disabled connection on purpose: the administrator who connects the account again
        through the callback has chosen to resume it.
        """
        self.ensure_one()
        self._liwan_store_secrets({'access_token': grant.access_token, 'refresh_token': grant.refresh_token})
        self.write(self._liwan_oauth_values(grant))
        self._liwan_record_state('connected', False, label)

    def _liwan_lock(self):
        """Serialize token refreshes across requests on this row (a LiwanOS table); a held lock is waited for."""
        self.ensure_one()
        self.env.cr.execute(SQL('SELECT id FROM %s WHERE id = %s FOR UPDATE', SQL.identifier(self._table), self.id))

    def _liwan_oauth_fresh(self):
        """Make sure the access token is valid for a while: refresh it once when it is near its deadline.

        The row is locked first, so two requests that find the same old deadline refresh once: the second waits
        for the lock, then reads the token the first one stored.
        """
        self.ensure_one()
        self._liwan_lock()
        self.invalidate_recordset()
        self.secret_ids.invalidate_recordset()
        names = set(self.secret_ids.mapped('name'))
        if not {'access_token', 'refresh_token'} <= names:
            self._liwan_reconnect_required()
        if self.token_expires_at and self.token_expires_at - TOKEN_MARGIN > fields.Datetime.now():
            return
        self._liwan_oauth_refresh()

    def _liwan_oauth_refresh(self):
        if self.refresh_expires_at and self.refresh_expires_at <= fields.Datetime.now():
            self._liwan_reconnect_required()
        config = self._liwan_oauth_config()
        try:
            grant = providers.MODULES[self.provider].refresh_tokens(config, self._liwan_secret('refresh_token'))
        except errors.ProviderError as error:
            # A transient failure (rate limit, 5xx, network) is retried by the caller: only a refused
            # authorization means the administrator has to connect the account again.
            if error.retryable:
                raise
            self._liwan_reconnect_required()
        # The state is left alone: a disabled connection stays disabled. The caller is an application user with read
        # access only, so the stored grant (the two token secrets and the two deadlines) is written elevated.
        stored = self.sudo()
        stored._liwan_store_secrets({'access_token': grant.access_token, 'refresh_token': grant.refresh_token})
        stored.write({'token_expires_at': grant.expires_at, 'refresh_expires_at': grant.refresh_expires_at})

    def _liwan_reconnect_required(self):
        """Mark the connection so the administrator sees it must be connected again; the caller gets a clear error.

        The marker is written in the caller's transaction: a request that then fails rolls it back with everything
        else, as the inbox code this replaces did.
        """
        message = self.env._('Connect the %(provider)s account again: its authorization is no longer valid.', provider=self.provider)
        # Elevated for the same reason as the refresh: the caller only reads the connection.
        self.sudo()._liwan_record_state('error', message)
        raise ReconnectRequired(message)
