# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok account behind one `liwan.inbox.channel` of kind `tiktok`.

The channel is keyed by the business account's own `open_id` (`tiktok_business_id`), which every
webhook delivery names as `user_openid`. The TikTok app key, app secret and redirect URI are
operator configuration (`adapters/tiktok.py: app_config`); a channel stores only its own tokens,
encrypted with `secret_box`.
"""
import os

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from . import secret_box
from .channel import INVALID, SECRET_GROUPS
from .constants import TIKTOK_TOKEN_MARGIN
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import errors, tiktok


class LiwanInboxChannel(models.Model):
    _inherit = 'liwan.inbox.channel'

    # The business account identity (D2): unique, and the routing key of its webhook deliveries.
    tiktok_business_id = fields.Char(copy=False)
    tiktok_username = fields.Char(copy=False)
    refresh_token_enc = fields.Char(groups=SECRET_GROUPS, copy=False)
    token_expires_at = fields.Datetime(copy=False)
    refresh_expires_at = fields.Datetime(copy=False)
    # The account's own welcome message (D10): TikTok holds its content and its audit status.
    tiktok_welcome_id = fields.Char(copy=False)
    tiktok_welcome_audit = fields.Selection(
        [('reviewing', 'Reviewing'), ('approved', 'Approved'), ('rejected', 'Rejected')], copy=False,
    )
    # Whether the shared relay holds this account's binding (D13); only the shared SaaS topology has one.
    tiktok_bound = fields.Boolean(default=False, copy=False)

    _tiktok_business_id_unique = models.Constraint(
        'UNIQUE(tiktok_business_id)', 'This TikTok business account is already connected.',
    )

    @api.constrains('kind', 'tiktok_business_id')
    def _check_tiktok_business_id(self):
        for channel in self.filtered(lambda channel: channel.kind == 'tiktok'):
            if not channel.tiktok_business_id:
                raise ValidationError(self.env._('A TikTok channel needs the business account open id.'))

    @api.model
    def _liwan_tiktok_config(self):
        """The operator's TikTok app configuration (environment); 422 `inbox_tiktok_not_configured` without it."""
        config = tiktok.app_config(os.environ)
        if config is None:
            message = self.env._('The TikTok app is not configured.')
            raise LiwanAccessRule(INVALID, message, details={'reason': 'inbox_tiktok_not_configured'})
        return config

    def _liwan_tiktok_store(self, grant, profile=None):
        """Store one OAuth answer on the channel (tokens encrypted) and mark it connected."""
        self.ensure_one()
        self.write({
            'tiktok_business_id': grant.open_id,
            'tiktok_username': profile.username if profile else self.tiktok_username,
            'access_token_enc': secret_box.encrypt(self.env, grant.access_token),
            'refresh_token_enc': secret_box.encrypt(self.env, grant.refresh_token),
            'token_expires_at': grant.expires_at,
            'refresh_expires_at': grant.refresh_expires_at,
            'state': 'connected',
            'last_error': False,
        })

    def _liwan_tiktok_credentials(self):
        """The account's credentials, refreshing the access token once when it is near its deadline.

        The channel row is locked first, so two requests that find the same old deadline refresh once:
        the second caller reads the token the first one stored.
        """
        self.ensure_one()
        self._liwan_tiktok_lock()
        self.invalidate_recordset([
            'access_token_enc', 'refresh_token_enc', 'token_expires_at', 'refresh_expires_at', 'state', 'last_error',
        ])
        if not (self.access_token_enc and self.refresh_token_enc):
            self._liwan_tiktok_reconnect_required()
        if self.token_expires_at and self.token_expires_at - TIKTOK_TOKEN_MARGIN > fields.Datetime.now():
            return tiktok.Credentials(self.tiktok_business_id, secret_box.decrypt(self.env, self.access_token_enc))
        return self._liwan_tiktok_refresh()

    def _liwan_tiktok_lock(self):
        """Serialize token refreshes across requests on the channel row (a LiwanOS table)."""
        self.ensure_one()
        self.env.cr.execute('SELECT id FROM liwan_inbox_channel WHERE id = %s FOR UPDATE', [self.id])

    def _liwan_tiktok_refresh(self):
        if self.refresh_expires_at and self.refresh_expires_at <= fields.Datetime.now():
            self._liwan_tiktok_reconnect_required()
        config = self._liwan_tiktok_config()
        try:
            grant = tiktok.refresh_tokens(config, secret_box.decrypt(self.env, self.refresh_token_enc))
        except errors.ProviderError as error:
            # A transient failure (rate limit, 5xx, network) is retried by the caller: only a refused
            # authorization means the customer has to reconnect the account.
            if error.retryable:
                raise
            self._liwan_tiktok_reconnect_required()
        self._liwan_tiktok_store(grant)
        return tiktok.Credentials(self.tiktok_business_id, grant.access_token)

    def _liwan_tiktok_reconnect_required(self):
        """Mark the channel so the administrator sees it must reconnect it; the caller gets a clear error."""
        message = self.env._('Reconnect the TikTok account: its authorization is no longer valid.')
        self.write({'state': 'error', 'last_error': message})
        raise UserError(message)

    # automation

    def _liwan_set_auto_message(self, purpose, content):
        """Store the welcome record and mirror it to TikTok; the away and rule replies stay LiwanOS's own."""
        super()._liwan_set_auto_message(purpose, content)
        if self.kind == 'tiktok' and purpose == 'welcome':
            self._liwan_tiktok_push_welcome()

    def _liwan_tiktok_push_welcome(self):
        """Push the welcome record to TikTok's own WELCOME_MESSAGE (D10); LiwanOS never sends that message itself."""
        self.ensure_one()
        if not self.access_token_enc:
            return
        credentials = self._liwan_credentials()
        welcome = self._liwan_auto_message('welcome')
        try:
            if not welcome:
                if self.tiktok_welcome_id:
                    tiktok.delete_auto_message(credentials, 'WELCOME_MESSAGE', self.tiktok_welcome_id)
                    self.write({'tiktok_welcome_id': False, 'tiktok_welcome_audit': False})
                return
            content = {'welcome_message': {'content': welcome.body}}
            if self.tiktok_welcome_id:
                tiktok.update_auto_message(credentials, 'WELCOME_MESSAGE', self.tiktok_welcome_id, content)
            else:
                self.tiktok_welcome_id = tiktok.create_auto_message(credentials, 'WELCOME_MESSAGE', content)
        except errors.ProviderError as error:
            raise UserError(str(error)) from error
        self.tiktok_welcome_audit = 'reviewing'
