# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import secrets

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .constants import AUTH_EXTERNAL, AUTH_OAUTH, SECRET_PURPOSE
from .errors import AccountTaken, ReconnectRequired
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

    _company_provider_external_unique = models.Constraint(
        'UNIQUE(company_id, provider, external_id)', 'this provider account is already connected for the company',
    )

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

    @api.constrains('provider', 'external_id', 'company_id')
    def _check_exclusive_account(self):
        """An exclusive provider's account belongs to one company of the database (constraints run elevated, so all rows are seen)."""
        definitions = self.env['liwan.integration.registry']._liwan_provider_map()
        for connection in self:
            if definitions.get(connection.provider, {}).get('exclusive') and self.search_count([
                ('provider', '=', connection.provider), ('external_id', '=', connection.external_id),
                ('id', '!=', connection.id),
            ]):
                raise AccountTaken(self.env._('This %(provider)s account is already connected in another company.', provider=connection.provider))

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
        if self._liwan_definition()['auth'] == AUTH_OAUTH:
            self._liwan_oauth_fresh()
        access_token = self._liwan_secret('access_token')
        if not access_token:
            raise errors.ProviderError(self.env._('The connection has no access token.'), retryable=False)
        return providers.MODULES[self.provider].probe(self.external_id, access_token)

    def _liwan_record_state(self, state, message, label=None):
        values = {'state': state, 'status_message': (message or '')[:MESSAGE_LENGTH] or False, 'last_checked': fields.Datetime.now()}
        if label:
            values['label'] = label
        self.write(values)
