# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from .constants import CHANNEL_FEATURES, CHANNEL_USES
from .integration_registry import USE_PROVIDERS
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.adapters.whatsapp import Credentials
from odoo.addons.liwan_integrations_sa.providers import errors as integration_errors

PROVIDER_ID = re.compile(r'^\d{5,32}$')
INVALID = 'invalid'


class LiwanInboxChannel(models.Model):
    _name = 'liwan.inbox.channel'
    _description = 'Customer Messages channel'
    _order = 'name, id'
    # Tenant scope: the channel is the tenant's webhook routing record (phone_number_id is unique in
    # the database) and the webhook resolves it before any company context exists, so it must reach
    # channels of every company, which liwan_core's per-request company fence (keyed on a field
    # called company_id) would refuse. Each channel still has an owning company: staff reach only
    # their companies' channels through the group rule on owner_company_id (security/inbox_rules.xml)
    # and the per-company capability check in controllers/helpers.py.
    _liwan_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                       default=lambda self: self.env.company)
    name = fields.Char(required=True)
    kind = fields.Selection([('whatsapp', 'WhatsApp'), ('tiktok', 'TikTok')], required=True, default='whatsapp')
    state = fields.Selection(
        [('draft', 'Draft'), ('connected', 'Connected'), ('error', 'Error'), ('disabled', 'Disabled')],
        required=True, default='draft', index=True,
    )
    department_id = fields.Many2one('liwan.inbox.department', ondelete='set null')
    # The provider account (its id, tokens and webhook secrets) lives on the connection of the integrations service.
    # A restricted delete keeps an account that a channel still uses.
    connection_id = fields.Many2one('liwan.integration.connection', required=True, index=True, ondelete='restrict')
    # The WhatsApp number of the account this channel serves; a TikTok channel is its account and has none.
    phone_number_id = fields.Char()
    last_error = fields.Char()
    last_event_at = fields.Datetime()
    conversation_ids = fields.One2many('liwan.inbox.conversation', 'channel_id')
    # Automation: the welcome and away messages (auto_message_ids) and the satisfaction survey.
    auto_message_ids = fields.One2many('liwan.inbox.auto.message', 'channel_id')
    welcome_enabled = fields.Boolean(default=False)
    welcome_idle_days = fields.Integer(default=0)
    away_enabled = fields.Boolean(default=False)
    away_repeat_hours = fields.Integer(default=12)
    csat_enabled = fields.Boolean(default=False)
    csat_question = fields.Char(required=True, default='كيف كانت تجربتك معنا؟')
    csat_good = fields.Char(required=True, default='ممتاز')
    csat_neutral = fields.Char(required=True, default='مقبول')
    csat_bad = fields.Char(required=True, default='سيئ')

    _phone_number_unique = models.Constraint(
        'UNIQUE(phone_number_id)', 'This WhatsApp phone number id is already connected.',
    )

    @api.constrains('welcome_idle_days', 'away_repeat_hours')
    def _check_automation_ranges(self):
        for channel in self:
            if not 0 <= channel.welcome_idle_days <= 365 or not 1 <= channel.away_repeat_hours <= 168:
                raise ValidationError(self.env._('welcome_idle_days must be 0 to 365 and away_repeat_hours 1 to 168.'))

    @api.constrains('csat_question', 'csat_good', 'csat_neutral', 'csat_bad')
    def _check_survey_texts(self):
        for channel in self:
            if len(channel.csat_question) > 1024 or any(
                not 1 <= len(label) <= 20 for label in (channel.csat_good, channel.csat_neutral, channel.csat_bad)
            ):
                raise ValidationError(self.env._('The survey question is at most 1024 characters and each answer 1 to 20.'))

    @api.constrains('kind', 'phone_number_id')
    def _check_phone_number_id(self):
        for channel in self.filtered(lambda channel: channel.kind == 'whatsapp'):
            if not PROVIDER_ID.match(channel.phone_number_id or ''):
                raise ValidationError(self.env._('The phone number id must be 5 to 32 digits.'))

    @api.constrains('kind', 'connection_id', 'owner_company_id')
    def _check_connection(self):
        """A channel serves the account of the provider of its kind, connected by its own company."""
        for channel in self:
            connection = channel.connection_id
            if connection.provider != USE_PROVIDERS[channel.kind] or connection.company_id != channel.owner_company_id:
                raise ValidationError(self.env._('The channel needs a %(provider)s connection of its own company.', provider=USE_PROVIDERS[channel.kind]))

    @api.model_create_multi
    def create(self, vals_list):
        """Gate each new channel by its own kind's sub-feature, then by the tenant's channel limit."""
        entitlement = self.env['liwan.entitlement.service']
        for feature in sorted({
            CHANNEL_FEATURES[kind] for kind in (vals.get('kind') or 'whatsapp' for vals in vals_list)
            if kind in CHANNEL_FEATURES
        }):
            entitlement.require(feature)
        entitlement._liwan_claim_channels(len(vals_list))
        return super().create(vals_list)

    def unlink(self):
        if self.conversation_ids:
            raise LiwanAccessRule(
                INVALID, self.env._('A channel with conversations cannot be deleted; disable it instead.'),
                details={'reason': 'inbox_channel_has_conversations'},
            )
        self.env['liwan.entitlement.service']._liwan_claim_channels(-len(self))
        return super().unlink()

    def _liwan_credentials(self):
        """The provider credentials of this channel, read from its connection (a TikTok token is refreshed by the service)."""
        self.ensure_one()
        try:
            access = self.connection_id._liwan_access(CHANNEL_USES[self.kind])
        except integration_errors.ProviderError as error:
            raise errors.ProviderError(str(error), error.retryable, error.code) from error
        if self.kind == 'tiktok':
            return tiktok.Credentials(access['external_id'], access['access_token'])
        if not access.get('access_token'):
            raise UserError(self.env._('The connection has no access token.'))
        return Credentials(
            phone_number_id=self.phone_number_id, business_account_id=access['external_id'], access_token=access['access_token'],
        )

    def _liwan_can_send(self):
        """Whether the channel is connected and so is the account behind it."""
        self.ensure_one()
        return self.state == 'connected' and self.connection_id.state == 'connected'

    @api.model
    def _liwan_sendable_domain(self):
        """The domain of the channels `_liwan_can_send` accepts."""
        return [('state', '=', 'connected'), ('connection_id.state', '=', 'connected')]

    def _liwan_test_connection(self):
        """Test the provider connection: Meta's health for WhatsApp, the business profile for TikTok."""
        self.ensure_one()
        if self.kind == 'tiktok':
            self._liwan_tiktok_test_connection()
        else:
            self._liwan_refresh_health()

    # webhook identity: it holds no capability in any company, so the account lookups and the webhook secrets come from
    # the integrations service's elevated webhook accessors; the channels are read through the hook group's own rows.
    # The provider signature or the handshake token checked with these values is the webhook's authentication.

    @api.model
    def _liwan_hook_channels(self, kind, external_ids=(), phone_number_ids=()):
        """The active channels of `kind` whose account id or phone number id a delivery names.

        A channel matched by its phone number whose connection is disabled stays in the answer: its connection
        yields no app secret, so the signature check refuses it.
        """
        accounts = self.env['liwan.integration.connection']._liwan_webhook_accounts(USE_PROVIDERS[kind], external_ids)
        matches = [
            match for match in (
                ('connection_id', 'in', [account['id'] for account in accounts]) if accounts else None,
                ('phone_number_id', 'in', list(phone_number_ids)) if phone_number_ids else None,
            ) if match
        ]
        if not matches:
            return self.browse()
        return self.search([('kind', '=', kind), ('state', '!=', 'disabled'), *['|'] * (len(matches) - 1), *matches], order='id')

    def _liwan_hook_secret(self, name):
        """One decrypted secret of the channel's connection for a webhook check, or None when it is not set."""
        self.ensure_one()
        return self.env['liwan.integration.connection']._liwan_webhook_secret(self.connection_id.id, name)

    @api.model
    def _liwan_hook_verify_tokens(self):
        """The webhook handshake tokens of every active WhatsApp account; the caller compares in constant time."""
        return self.env['liwan.integration.connection']._liwan_webhook_secrets(USE_PROVIDERS['whatsapp'], 'verify_token')

    def _liwan_auto_message(self, purpose):
        """The welcome or away message of the channel (empty when none is set)."""
        self.ensure_one()
        return self.auto_message_ids.filtered(lambda message: message.purpose == purpose)

    def _liwan_set_auto_message(self, purpose, content):
        """Store the welcome or away content (model values; None removes it)."""
        self.ensure_one()
        self.env['liwan.inbox.auto.message']._liwan_upsert(
            self._liwan_auto_message(purpose), {'purpose': purpose, 'channel_id': self.id}, content,
        )

    def _liwan_fill_automation(self, welcome, away):
        """Set the welcome and away messages that the channel does not have yet (a sector preset); they stay as switched."""
        self.ensure_one()
        for purpose, content in (('welcome', welcome), ('away', away)):
            if content and not self._liwan_auto_message(purpose):
                self._liwan_set_auto_message(purpose, content)

    def _liwan_catalog_id(self):
        """The Meta catalog id this channel's WhatsApp account sells from; none without a product catalog (hook)."""
        self.ensure_one()
        return False
