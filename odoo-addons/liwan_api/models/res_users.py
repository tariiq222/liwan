# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import logging
import secrets
from time import time

from odoo import fields, models
from odoo.exceptions import AccessDenied
from odoo.http import request

_logger = logging.getLogger(__name__)

LOGIN_CHALLENGE = 'liwan_login_challenge'
LOGIN_CHALLENGE_TTL = 10 * 60


def fresh_session_token(user, sid):
    """Compute a session token from the current row without consulting ormcache."""
    values = user._session_token_get_values()
    return user._session_token_hash_compute(sid, values)


APPEARANCE_MODES = ('light', 'cream', 'dark')
FONT_SIZES = ('small', 'medium', 'large')
# Personal display preferences: each user writes their own through
# /api/v1/me/appearance, so they are self-writable and never part of the
# access-managed identity.
APPEARANCE_FIELDS = ('liwan_appearance_mode', 'liwan_font_size')


class LiwanApiResUsers(models.Model):
    _inherit = 'res.users'

    liwan_appearance_mode = fields.Selection(
        [('light', 'Light'), ('cream', 'Cream'), ('dark', 'Dark')],
        default='light',
        required=True,
    )
    liwan_font_size = fields.Selection(
        [('small', 'Small'), ('medium', 'Medium'), ('large', 'Large')],
        default='small',
        required=True,
    )

    @property
    def SELF_READABLE_FIELDS(self):
        return super().SELF_READABLE_FIELDS + list(APPEARANCE_FIELDS)

    @property
    def SELF_WRITEABLE_FIELDS(self):
        return super().SELF_WRITEABLE_FIELDS + list(APPEARANCE_FIELDS)

    def _liwan_unversioned_fields(self):
        # A display preference is not an access change; it must not bump the
        # user's access version that administrators lock against.
        return super()._liwan_unversioned_fields() | set(APPEARANCE_FIELDS)

    @contextlib.contextmanager
    def _assert_can_auth(self, user=None):
        """Slow guessing of one account by its login instead of by client address (see ``liwan.login.throttle``).

        Replaces Odoo's per-address cooldown, which behind the proxy is one address for the whole tenant; the
        per-address limit stays at the edge, which sees the real client. A delayed attempt gets the plain
        ``AccessDenied`` of a wrong password, so the answer never says that the account is slowed.
        """
        if not request:
            yield
            return
        throttle = self.env['liwan.login.throttle']
        login = throttle._liwan_login_of(user)
        key = throttle._liwan_key(login)
        state = throttle._liwan_state(key)
        if throttle._liwan_delayed(state):
            raise AccessDenied
        try:
            yield
        except AccessDenied:
            try:
                throttle._liwan_record_failure(key, login)
            except Exception as error:  # noqa: BLE001 - a counter fault must not turn the refusal into a server error
                _logger.warning('sign-in failure not counted: %s', type(error).__name__)
            raise
        else:
            if state:
                throttle._liwan_clear(key)

    def _login(self, credential, user_agent_env):
        interactive_password = request and (user_agent_env or {}).get('interactive') and credential.get('type') == 'password'
        if interactive_password:
            request.session.pop(LOGIN_CHALLENGE, None)
        auth_info = super()._login(credential, user_agent_env)
        if interactive_password:
            # Use a nonce rather than the session ID, which Odoo may rotate while saving this request.
            nonce = secrets.token_urlsafe()
            user = self.with_user(auth_info['uid']).env.user
            request.session[LOGIN_CHALLENGE] = {
                'nonce': nonce,
                'token': fresh_session_token(user, nonce),
                'access_version': user.liwan_access_version,
                'expires': time() + LOGIN_CHALLENGE_TTL,
            }
        return auth_info
