# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections.abc import Mapping

from odoo import api, models

from odoo.addons.liwan_integrations_sa import providers

# The callback kinds a provider may deliver to the public hook route.
CALLBACK_KINDS = ('message-status',)
# What `_liwan_apply_callback` answers; the controller maps each to its HTTP status.
APPLIED = 'applied'
IGNORED = 'ignored'
NOT_FOUND = 'not_found'
INVALID = 'invalid'
FORBIDDEN = 'forbidden'


class LiwanIntegrationConnectionCallback(models.Model):
    _inherit = 'liwan.integration.connection'

    @api.model
    def _liwan_apply_callback(self, provider, connection_id, kind, params, headers):
        """Apply one signed provider callback (a delivery status) and answer one of the result codes above.

        The caller is the anonymous public user of a session-less route, who holds no ACL on connections, secrets or
        logs, so the lookup is elevated, like ``liwan.sales.answer._liwan_open``: it finds the connection and the
        record the callback names, verifies the provider signature against the URL stored on that record, and only
        then applies the status in the connection's company. An unknown record answers ``ignored`` before any check,
        so nothing is written and nothing is revealed.
        """
        module = providers.MODULES.get(provider)
        if kind not in CALLBACK_KINDS or not callable(getattr(module, 'verify_callback', None)):
            return NOT_FOUND
        if not isinstance(params, Mapping) or not isinstance(headers, Mapping):
            return INVALID
        # Elevated: the connection company rule and the capability fence admit the public user to no company.
        connection = self.sudo().browse(connection_id).exists()
        if not connection or connection.provider != provider or connection.state == 'disabled':
            return NOT_FOUND
        connection = connection.with_company(connection.company_id)
        record = connection._liwan_callback_record(kind, params)
        if not record:
            return IGNORED
        if not module.verify_callback(connection._liwan_callback_secrets(), record.status_callback_url, params, headers):
            return FORBIDDEN
        return APPLIED if record._liwan_apply_callback_status(kind, params) else IGNORED

    def _liwan_callback_record(self, kind, params):
        """The log row a callback of ``kind`` names on this connection, or None; the model that owns a kind
        extends this through ``super()``.
        """
        self.ensure_one()
        return

    def _liwan_callback_secrets(self):
        """``{name: value}`` of the provider's declared webhook secrets, the keys a callback signature is checked with."""
        self.ensure_one()
        return {name: self._liwan_secret(name) for name in self._liwan_definition()['webhook_secrets']}
