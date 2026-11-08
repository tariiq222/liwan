# Part of Odoo. See LICENSE file for full copyright and licensing details.
import secrets
from time import time

from odoo import fields, models
from odoo.http import request

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
