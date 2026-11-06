# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok account behind one `liwan.inbox.channel` of kind `tiktok`.

The channel is keyed by the business account's own `open_id` (`tiktok_business_id`), which every
webhook delivery names as `user_openid`. The TikTok app key, app secret and redirect URI are
operator configuration (`adapters/tiktok.py: app_config`); a channel stores only its own tokens,
encrypted with `secret_box`.
"""
import logging
import os
from urllib.parse import quote

import requests

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from . import secret_box
from .channel import INVALID, SECRET_GROUPS
from .constants import TIKTOK_TOKEN_MARGIN
from .tiktok_shortcut import AUDIT_STATUSES, AUTO_TYPES, ENABLED_FIELDS
from .tiktok_sync import ACTIVE_STATES
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import errors, tiktok

_logger = logging.getLogger(__name__)

RELAY_TIMEOUT_SECONDS = 5
RELAY_TOKEN_HEADER = 'X-Liwan-Proxy-Token'


def _liwan_tiktok_relay_config():
    """The shared relay's base URL and proxy token from the operator environment, or None (D13).

    The URL is operator configuration: without it the tenant keeps its own direct webhook (the
    `non_saas` topology) and no relay call is made. It is never a condition on the customer type (R6).
    """
    url = (os.environ.get('LIWAN_TIKTOK_RELAY_URL') or '').strip().rstrip('/')
    if not url:
        return None
    token = (os.environ.get('LIWAN_SHARED_PROXY_TOKEN') or '').strip()
    if not token:
        _logger.warning('LIWAN_TIKTOK_RELAY_URL is set without LIWAN_SHARED_PROXY_TOKEN; the relay stays unused')
        return None
    return url, token


def _liwan_tiktok_relay_answer(dbname, channel_id, method, open_id):
    """The shared relay's answer to one binding call, or None when this deployment runs no relay.

    Both the bind and the unbind name this tenant, because the shared proxy token alone proves no
    tenant: the relay removes a binding only for the tenant that owns it. A binding never makes a
    connect or a delete fail: the failure is logged without the token, and the cron retries an
    unbound channel.
    """
    config = _liwan_tiktok_relay_config()
    if config is None:
        return None
    url, token = config
    try:
        return requests.request(
            method,
            f'{url}/internal/tiktok/bindings/{quote(open_id, safe="")}',
            # The shared registry knows this tenant by the database identifier, its only identity here.
            json={'tenant_id': dbname},
            headers={RELAY_TOKEN_HEADER: token},
            timeout=RELAY_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        _logger.warning('tiktok relay %s failed for channel %s: %s', method, channel_id, type(error).__name__)
        return None


def _liwan_tiktok_relay_delete(dbname, channel_id, open_id):
    """Remove one account's relay binding for this tenant; a failure leaves a stale binding that routes no event."""
    answer = _liwan_tiktok_relay_answer(dbname, channel_id, 'DELETE', open_id)
    if answer is not None and not answer.ok:
        _logger.warning('tiktok relay refused the unbinding of channel %s: HTTP %s', channel_id, answer.status_code)


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
    # Suggested questions and chat prompts (D10): LiwanOS holds the items and mirrors them to TikTok.
    tiktok_questions_enabled = fields.Boolean(default=False, copy=False)
    tiktok_prompts_enabled = fields.Boolean(default=False, copy=False)
    tiktok_shortcut_ids = fields.One2many('liwan.inbox.tiktok.shortcut', 'channel_id')

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
        previous = self.tiktok_business_id
        switched = bool(previous and previous != grant.open_id)
        self.write({
            'tiktok_business_id': grant.open_id,
            'tiktok_username': profile.username if profile else self.tiktok_username,
            'access_token_enc': secret_box.encrypt(self.env, grant.access_token),
            'refresh_token_enc': secret_box.encrypt(self.env, grant.refresh_token),
            'token_expires_at': grant.expires_at,
            'refresh_expires_at': grant.refresh_expires_at,
            'state': 'connected',
            'last_error': False,
            **({'tiktok_bound': False} if switched else {}),
        })
        if switched:
            # The channel now serves another account: the old account's routing must leave this tenant.
            self._liwan_tiktok_unbind(previous)

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

    def _liwan_tiktok_test_connection(self):
        """The connection test of a TikTok channel: read the business profile, then mark it connected or error.

        A disabled channel that fails stays disabled, so a failed activation never resumes its traffic.
        """
        self.ensure_one()
        try:
            with self.env.cr.savepoint():
                profile = tiktok.business_profile(self._liwan_tiktok_credentials())
        except errors.ProviderError as error:
            self.write({'state': 'disabled' if self.state == 'disabled' else 'error', 'last_error': str(error)})
        else:
            values = {'state': 'connected', 'last_error': False}
            if profile.username:
                values['tiktok_username'] = profile.username
            self.write(values)

    def _liwan_tiktok_reconnect_required(self):
        """Mark the channel so the administrator sees it must reconnect it; the caller gets a clear error."""
        message = self.env._('Reconnect the TikTok account: its authorization is no longer valid.')
        self.write({'state': 'error', 'last_error': message})
        raise UserError(message)

    # relay binding (D13)

    def _liwan_tiktok_bind(self):
        """Register the account with the shared relay; `tiktok_bound` records whether it succeeded."""
        self.ensure_one()
        if not self.tiktok_business_id:
            return False
        answer = _liwan_tiktok_relay_answer(self.env.cr.dbname, self.id, 'PUT', self.tiktok_business_id)
        if answer is None:
            return False
        if not answer.ok:
            _logger.warning('tiktok relay refused the binding of channel %s: HTTP %s', self.id, answer.status_code)
            return False
        self.tiktok_bound = True
        return True

    def _liwan_tiktok_unbind(self, open_id=None):
        """Remove one account's relay binding, by default this channel's own."""
        self.ensure_one()
        open_id = open_id or self.tiktok_business_id
        if not open_id:
            return
        _liwan_tiktok_relay_delete(self.env.cr.dbname, self.id, open_id)
        if open_id == self.tiktok_business_id:
            self.tiktok_bound = False

    def unlink(self):
        """Deleting a channel removes its relay routing with it; a refused deletion keeps the binding."""
        bindings = [
            (channel.id, channel.tiktok_business_id)
            for channel in self.filtered(lambda channel: channel.kind == 'tiktok' and channel.tiktok_business_id)
        ]
        result = super().unlink()
        for channel_id, open_id in bindings:
            _liwan_tiktok_relay_delete(self.env.cr.dbname, channel_id, open_id)
        return result

    @api.model
    def _liwan_retry_tiktok_bindings(self):
        """The cron step: register every active TikTok account the shared relay does not hold yet."""
        channels = self.search([
            ('kind', '=', 'tiktok'), ('state', 'in', ('connected', 'error')),
            ('tiktok_business_id', '!=', False), ('tiktok_bound', '=', False),
        ])
        for channel in channels:
            channel._liwan_tiktok_bind()

    # history import (D11)

    def _liwan_tiktok_active_sync(self):
        """The channel's unfinished history import, if any: one runs at a time."""
        self.ensure_one()
        return self.env['liwan.inbox.tiktok.sync'].search([
            ('channel_id', '=', self.id), ('state', 'in', ACTIVE_STATES),
        ], limit=1)

    def _liwan_tiktok_queue_sync(self):
        """Queue one history import; a second request while one runs is 422 `inbox_tiktok_sync_running`."""
        self.ensure_one()
        # The row lock makes the "none is active" answer and the create one step under two concurrent requests.
        self._liwan_tiktok_lock()
        if self._liwan_tiktok_active_sync():
            raise LiwanAccessRule(
                INVALID, self.env._('A history import of this TikTok account is already running.'),
                details={'reason': 'inbox_tiktok_sync_running'},
            )
        return self.env['liwan.inbox.tiktok.sync'].create({
            'channel_id': self.id, 'owner_company_id': self.owner_company_id.id,
        })

    def _liwan_tiktok_queue_first_sync(self):
        """Queue the account's history import after a connect; an account that already imported one adds nothing.

        A job that failed did not import, so reconnecting the account starts the import again.
        """
        self.ensure_one()
        sync = self.env['liwan.inbox.tiktok.sync']
        if sync.search_count([('channel_id', '=', self.id), ('state', '!=', 'failed')]):
            return sync
        return self._liwan_tiktok_queue_sync()

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

    def _liwan_tiktok_set_enabled(self, kind, enabled):
        """Switch one kind of automatic message on or off; enabling recreates every stored item.

        TikTok disables every existing item of the kind when the kind is enabled, so the stored items are
        created again (a new provider id) instead of being updated.
        """
        self.ensure_one()
        credentials = self._liwan_credentials()
        try:
            tiktok.set_auto_message_status(credentials, AUTO_TYPES[kind], enabled)
        except errors.ProviderError as error:
            raise LiwanAccessRule(
                INVALID, self.env._('TikTok refused the change: %(error)s', error=str(error)),
                details={'reason': 'inbox_tiktok_auto_message_refused'},
            ) from error
        self.write({ENABLED_FIELDS[kind]: enabled})
        if not enabled:
            return
        for shortcut in self.tiktok_shortcut_ids.filtered(lambda shortcut: shortcut.kind == kind):
            shortcut.write({'provider_id': False, 'audit': 'draft', 'sync_error': False})
            shortcut._liwan_push()

    def _liwan_tiktok_refresh_audit(self):
        """Read TikTok's audit answer and enabled status back for the welcome, the questions and the prompts."""
        self.ensure_one()
        credentials = self._liwan_credentials()
        if self.tiktok_welcome_id:
            _enabled, audits = self._liwan_tiktok_auto_messages(credentials, 'WELCOME_MESSAGE')
            self.tiktok_welcome_audit = audits.get(self.tiktok_welcome_id) or self.tiktok_welcome_audit
        for kind, auto_type in AUTO_TYPES.items():
            shortcuts = self.tiktok_shortcut_ids.filtered(
                lambda shortcut: shortcut.kind == kind and shortcut.provider_id,
            )
            if not shortcuts and not self[ENABLED_FIELDS[kind]]:
                continue
            enabled, audits = self._liwan_tiktok_auto_messages(credentials, auto_type)
            self[ENABLED_FIELDS[kind]] = enabled
            for shortcut in shortcuts:
                audit = audits.get(shortcut.provider_id)
                if audit:
                    shortcut.audit = audit

    def _liwan_tiktok_auto_messages(self, credentials, auto_type):
        """(whether TikTok has this kind enabled, {auto message id: audit status})."""
        status, items = tiktok.get_auto_messages(credentials, auto_type)
        audits = {
            item.get('auto_message_id'): AUDIT_STATUSES.get(str(item.get('audit_status') or '').upper())
            for item in items
        }
        return status == 'ENABLE', audits
