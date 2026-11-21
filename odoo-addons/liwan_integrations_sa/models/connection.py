# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import secrets

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .constants import AUTH_EXTERNAL, AUTH_OAUTH, SECRET_PURPOSE
from .errors import ReconnectRequired
from odoo.addons.liwan_core.models import secret_box
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.providers import errors

STATES = [('pending', 'Pending'), ('connected', 'Connected'), ('error', 'Error'), ('disabled', 'Disabled')]
# The refresh token never leaves the service: an application receives the access token only.
INTERNAL_SECRETS = frozenset({'refresh_token'})
MESSAGE_LENGTH = 200


class LiwanIntegrationConnection(models.Model):
    """One connected provider account of a company, with its encrypted secrets and its state.

    Applications never import this model: they ask for the connection of one of their registered uses
    (``_liwan_for_use``) and read its credentials through ``_liwan_access``. An external provider (ZATCA,
    a payment gateway) has no row: its owner derives the status at read time.
    """
    _name = 'liwan.integration.connection'
    _description = 'LiwanOS integration connection'
    _liwan_scope = 'company'
    _order = 'provider, id'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    provider = fields.Char(required=True)
    external_id = fields.Char(required=True, copy=False)
    label = fields.Char()
    app_id = fields.Char()
    state = fields.Selection(STATES, required=True, default='pending')
    status_message = fields.Char()
    last_checked = fields.Datetime()
    scopes = fields.Char(copy=False)
    token_expires_at = fields.Datetime(copy=False)
    refresh_expires_at = fields.Datetime(copy=False)
    secret_ids = fields.One2many('liwan.integration.secret', 'connection_id')
    # The names of the secrets that are set: presence is public, a value never is. Read without the secret ACL on purpose.
    secret_names = fields.Json(compute='_compute_secret_names', compute_sudo=True)

    # Whether the provider keeps an account to one company of the database (its registry definition), stored and part
    # of the insert so the database itself refuses a second row: two companies finishing a connection at the same
    # moment cannot both pass, which no check made in Python could guarantee.
    exclusive = fields.Boolean(compute='_compute_exclusive', store=True, precompute=True)

    _company_provider_external_unique = models.Constraint(
        'UNIQUE(company_id, provider, external_id)', 'this provider account is already connected for the company',
    )
    _exclusive_account_unique = models.UniqueIndex(
        '(provider, external_id) WHERE exclusive IS TRUE', 'This provider account is already connected in another company.',
    )

    @api.depends('provider')
    def _compute_exclusive(self):
        definitions = self.env['liwan.integration.registry']._liwan_provider_map()
        for connection in self:
            connection.exclusive = bool(definitions.get(connection.provider, {}).get('exclusive'))

    @api.constrains('provider')
    def _check_provider(self):
        providers_by_code = self.env['liwan.integration.registry']._liwan_provider_map()
        for connection in self:
            definition = providers_by_code.get(connection.provider)
            if not definition or definition['auth'] == AUTH_EXTERNAL:
                raise ValidationError(self.env._('%(provider)s is not a provider with stored connections.', provider=connection.provider))

    @api.constrains('provider', 'external_id')
    def _check_external_id_format(self):
        definitions = self.env['liwan.integration.registry']._liwan_provider_map()
        for connection in self:
            pattern = definitions.get(connection.provider, {}).get('external_id_pattern')
            if pattern and not re.fullmatch(pattern, connection.external_id or ''):
                raise ValidationError(self.env._('The account id %(id)s is not valid for %(provider)s.', id=connection.external_id, provider=connection.provider))

    @api.depends('secret_ids.name')
    def _compute_secret_names(self):
        for connection in self:
            connection.secret_names = sorted(connection.secret_ids.mapped('name'))

    def _liwan_definition(self):
        self.ensure_one()
        return self.env['liwan.integration.registry']._liwan_provider_map()[self.provider]

    @api.model
    def _liwan_use(self, use_key):
        """The registered use ``use_key``; a use that no addon registered is a programming error."""
        use = self.env['liwan.integration.registry']._liwan_use_map().get(use_key)
        if not use:
            raise UserError(self.env._('The use %(use)s is not registered.', use=use_key))
        return use

    @api.model
    def _liwan_for_use(self, use_key):
        """The connections of the current company to the provider of ``use_key`` that are not disabled."""
        provider = self._liwan_use(use_key)['provider']
        return self.search([
            ('company_id', '=', self.env.company.id), ('provider', '=', provider), ('state', '!=', 'disabled'),
        ])

    def _liwan_access(self, use_key):
        """The credentials one use may call the provider with: ``external_id``, ``app_id`` and the secrets.

        The use must be registered for this connection's provider, its feature open, every scope it needs
        granted and the connection not disabled. An oauth connection refreshes its access token first.
        """
        self.ensure_one()
        use = self._liwan_use(use_key)
        if use['provider'] != self.provider:
            raise UserError(self.env._('The use %(use)s does not belong to this connection.', use=use_key))
        self.env['liwan.entitlement.service'].require_read(use['feature_key'])
        if self.state == 'disabled':
            raise UserError(self.env._('This connection is disabled.'))
        if not set(use['scopes']) <= set((self.scopes or '').split()):
            raise UserError(self.env._('The connection has not granted the access %(use)s needs; connect the account again.', use=use_key))
        if self._liwan_definition()['auth'] == AUTH_OAUTH:
            self._liwan_oauth_fresh()
        values = {name: value for name, value in self._liwan_secrets().items() if name not in INTERNAL_SECRETS}
        return {'external_id': self.external_id, 'app_id': self.app_id or None, **values}

    def _liwan_secrets(self):
        self.ensure_one()
        return {
            secret.name: secret_box.decrypt(self.env, SECRET_PURPOSE, secret.value_enc) for secret in self.secret_ids
        }

    def _liwan_secret(self, name):
        """One decrypted secret (a webhook signature check needs the app secret), or None when it is not set."""
        self.ensure_one()
        secret = self.secret_ids.filtered(lambda row: row.name == name)
        return secret_box.decrypt(self.env, SECRET_PURPOSE, secret.value_enc) if secret else None

    # Webhooks have no session: the caller is a machine identity that holds no capability in any company, so the
    # company record rules and the capability fence would hide every connection from it. The provider signature or
    # the handshake token that a caller checks with these values is the webhook's whole authentication. Each accessor
    # elevates one read and returns plain data, never a recordset of the elevated environment. A caller must compare
    # the values it gets in constant time (`hmac.compare_digest`).

    def _liwan_account_connection_ids(self):
        """The ids of every connection to this provider account, in any company and any state.

        A limit the provider keeps per account (a messaging budget) is shared by every company that connected it, so
        an application counts its usage over all of them. Elevated: the company rule hides the other companies' rows.
        Only ids are returned.
        """
        self.ensure_one()
        return self.sudo().search([('provider', '=', self.provider), ('external_id', '=', self.external_id)]).ids

    @api.model
    def _liwan_webhook_provider(self, provider):
        definition = self.env['liwan.integration.registry']._liwan_provider_map().get(provider)
        if not definition or definition['auth'] == AUTH_EXTERNAL:
            raise ValidationError(self.env._('%(provider)s is not a provider with stored connections.', provider=provider))
        return definition

    @api.model
    def _liwan_webhook_check_name(self, provider, name):
        if name not in self._liwan_webhook_provider(provider)['webhook_secrets']:
            raise ValidationError(self.env._('%(name)s is not a secret a webhook of %(provider)s may read.', name=name, provider=provider))

    @api.model
    def _liwan_webhook_accounts(self, provider, external_ids):
        """``[{'id', 'company_id', 'external_id'}]`` of the not disabled connections of ``provider`` that hold one of
        ``external_ids``, in any company of the database (a delivery names the account before any company is known).
        """
        self._liwan_webhook_provider(provider)
        # Elevated: the connection company rule and the capability fence admit a webhook identity to no company.
        found = self.sudo().search([
            ('provider', '=', provider), ('external_id', 'in', list(external_ids)), ('state', '!=', 'disabled'),
        ])
        return [{'id': row.id, 'company_id': row.company_id.id, 'external_id': row.external_id} for row in found]

    @api.model
    def _liwan_webhook_secret(self, connection_id, name):
        """The decrypted secret ``name`` of one not disabled connection, or None; only the names its provider declares
        in ``webhook_secrets`` are readable here.
        """
        connection = self.sudo().browse(connection_id).exists()
        if not connection:
            return None
        self._liwan_webhook_check_name(connection.provider, name)
        return None if connection.state == 'disabled' else connection._liwan_secret(name)

    @api.model
    def _liwan_webhook_secrets(self, provider, name):
        """The decrypted secret ``name`` of every not disabled connection of ``provider`` (a handshake compares the
        token it was presented with against all of them); only a name in the provider's ``webhook_secrets``.
        """
        self._liwan_webhook_check_name(provider, name)
        connections = self.sudo().search([('provider', '=', provider), ('state', '!=', 'disabled')])
        return [value for value in (connection._liwan_secret(name) for connection in connections) if value]

    def _liwan_store_secrets(self, values):
        """Encrypt and store ``{name: value}``, replacing a secret of the same name."""
        self.ensure_one()
        for name, value in values.items():
            encrypted = secret_box.encrypt(self.env, SECRET_PURPOSE, value)
            existing = self.secret_ids.filtered(lambda row: row.name == name)
            if existing:
                existing.value_enc = encrypted
            else:
                self.env['liwan.integration.secret'].create({'connection_id': self.id, 'name': name, 'value_enc': encrypted})

    def _liwan_generate_secrets(self):
        """Create the secrets the service generates itself (a webhook handshake token) that are still missing."""
        self.ensure_one()
        present = set(self.secret_ids.mapped('name'))
        self._liwan_store_secrets({
            name: secrets.token_urlsafe(24) for name in self._liwan_definition()['generated_secrets'] if name not in present
        })

    def _liwan_rotate_secret(self, name):
        """Replace one generated secret and return the new value once, for the administrator to paste at the provider."""
        self.ensure_one()
        if name not in self._liwan_definition()['generated_secrets']:
            raise ValidationError(self.env._('%(name)s is not a secret this service generates.', name=name))
        value = secrets.token_urlsafe(24)
        self._liwan_store_secrets({name: value})
        return value

    def _liwan_test(self):
        """Probe the provider with the stored credentials and record the outcome.

        A passing probe connects the account; a failing one marks it ``error`` with a short message. A disabled
        connection stays disabled whatever the probe says (the label and the check time still update): only a
        patch to ``pending`` or an OAuth reconnect re-enables it. Returns whether the probe passed.
        """
        self.ensure_one()
        disabled = self.state == 'disabled'
        try:
            with self.env.cr.savepoint():
                label = self._liwan_probe()
        except (errors.ProviderError, ReconnectRequired) as error:
            self._liwan_record_state('disabled' if disabled else 'error', str(error))
            return False
        self._liwan_record_state('disabled' if disabled else 'connected', False, label)
        return True

    def _liwan_probe(self):
        """The account's display name as the provider's probe reads it with the current credentials."""
        return providers.MODULES[self.provider].probe(self.external_id, self._liwan_provider_credentials())

    def _liwan_provider_credentials(self):
        """``{name: value}`` a provider function is called with: the decrypted declared secrets of a keys provider,
        ``{'access_token'}`` (refreshed first) of an OAuth one. A missing secret is refused before any call.
        """
        self.ensure_one()
        if self._liwan_definition()['auth'] == AUTH_OAUTH:
            self._liwan_oauth_fresh()
            names = ('access_token',)
        else:
            names = self._liwan_definition()['secrets']
        credentials = {name: self._liwan_secret(name) for name in names}
        missing = [name for name, value in credentials.items() if not value]
        if missing:
            raise errors.ProviderError(self.env._('The connection has no %(name)s.', name=missing[0]), retryable=False)
        return credentials

    def _liwan_record_state(self, state, message, label=None):
        values = {'state': state, 'status_message': (message or '')[:MESSAGE_LENGTH] or False, 'last_checked': fields.Datetime.now()}
        if label:
            values['label'] = label
        self.write(values)
