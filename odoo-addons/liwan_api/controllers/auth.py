# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hmac
import re
from time import time

from odoo import http
from odoo.exceptions import AccessDenied, LockError
from odoo.http import request

from odoo.addons.liwan_api.controllers.access_admin import require_exact
from odoo.addons.liwan_api.controllers.common import (
    WORKING_COMPANY_KEY,
    ApiError,
    api_handler,
    refusal_response,
)
from odoo.addons.liwan_api.models.res_users import LOGIN_CHALLENGE, fresh_session_token
from odoo.addons.liwan_api.serializers.user import dump_me
from odoo.addons.liwan_core.models.login_code import CHANNELS
from odoo.addons.liwan_platform.models.entitlement_service import LiwanTenantSuspended

NO_PENDING = (401, 'no_pending_login', 'No sign-in is pending a second step')
# The remembered-device token of one browser: an opaque secret, never the session cookie.
DEVICE_COOKIE = 'liwan_device'
DEVICE_COOKIE_PATH = '/'
DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60
DEVICE_TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{20,256}$')


def _refusal(code, resend_after=0):
    return refusal_response(code, resend_after)


def _pending_user(*, lock=False):
    """Validate the server-side proof of a recent password step before using its account."""
    session = request.session
    pre_uid = session.get('pre_uid')
    challenge = session.get(LOGIN_CHALLENGE)
    if session.uid or not pre_uid or not challenge or challenge['expires'] <= time():
        raise ApiError(*NO_PENDING)
    user = request.env(user=pre_uid)['res.users'].browse(pre_uid)
    if lock:
        try:
            # Order verification with password resets and account disable before any code is consumed.
            user.lock_for_update(allow_referencing=True)
        except LockError:
            raise ApiError(*NO_PENDING) from None
    if not user.exists():
        raise ApiError(*NO_PENDING)
    _assert_login_allowed(user)
    # Re-enabling an account can restore the original native token inputs. The version cannot go back.
    if challenge.get('access_version') != user.liwan_access_version:
        raise ApiError(*NO_PENDING)
    current = fresh_session_token(user, challenge['nonce'])
    if not current or not hmac.compare_digest(challenge['token'], current):
        raise ApiError(*NO_PENDING)
    return user


def _assert_login_allowed(user):
    """The same lifecycle gate the password step applies, answered with its own machine codes."""
    if not user.active or user.share:
        raise ApiError(403, 'login_refused', 'this account may not sign in')
    service = request.env(user=user.id)['liwan.entitlement.service']
    try:
        service._liwan_assert_login_allowed(user)
    except LiwanTenantSuspended:
        raise ApiError(403, 'tenant_suspended', 'this tenant is suspended') from None
    except AccessDenied:
        raise ApiError(403, 'login_refused', 'this account may not sign in') from None


def _finish(user, device=None):
    """Promote the pre-session into a signed-in one.

    The device token travels in its own cookie, set on the answer, so the browser can offer
    "this device is remembered" without ever handing the token to page code.
    """
    request.session.pop(LOGIN_CHALLENGE, None)
    # A new sign-in starts in the home company, whatever the session it replaces was working in.
    request.session.pop(WORKING_COMPANY_KEY, None)
    request.session.finalize(request.env)
    request.update_env(user=request.session.uid)
    body = dump_me(request.env.user)
    body['remembered'] = device is not None
    return body


class AuthController(http.Controller):

    @http.route('/api/v1/auth/channels', type='json2', auth='public', methods=['GET'], readonly=True)
    @api_handler
    def channels(self):
        """What a pending sign-in may use: SMS only when a provider is configured, email always.

        ``has_mobile`` says whether a code may go out by SMS for this account: only a number a code
        has already verified carries sign-in codes; ``_liwan_issue`` refuses the SMS of a pending
        sign-in for anything else.
        """
        user = request.env.user
        if not user or user._is_public():
            user = _pending_user()
        gateway = request.env['liwan.sms.gateway']
        available = [channel for channel in CHANNELS if channel != 'sms' or gateway._liwan_sms_available()]
        return {
            'channels': available,
            'sms_available': gateway._liwan_sms_available(),
            'has_mobile': bool(user.liwan_mobile and user.liwan_mobile_verified_at),
            'has_email': bool(user.email),
        }

    @http.route('/api/v1/auth/code', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def send_code(self, **payload):
        require_exact(payload, {'channel'}, {'channel'})
        user = _pending_user(lock=True)
        channel = payload['channel']
        if channel not in CHANNELS:
            raise ApiError(422, 'invalid_channel', "channel must be 'sms' or 'email'", field='channel')
        # The code table is system-only; the access service is its single documented reader/writer.
        outcome = request.env['liwan.access.service']._liwan_codes()._liwan_issue(user, channel)
        if outcome.error:
            return _refusal(outcome.error, outcome.resend_after)
        return {
            'channel': outcome.channel,
            'destination': outcome.destination,
            'resend_after': outcome.resend_after,
        }

    @http.route('/api/v1/auth/verify', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def verify(self, **payload):
        require_exact(payload, {'code', 'remember', 'label'}, {'code'})
        user = _pending_user(lock=True)
        error = request.env['liwan.access.service']._liwan_codes()._liwan_verify(user, payload['code'])
        if error:
            return _refusal(error)
        device = None
        if payload.get('remember') is True:
            label = payload.get('label')
            device, raw = request.env['liwan.access.service']._liwan_devices()._liwan_issue(
                user, label if isinstance(label, str) else '',
            )
            _set_device_cookie(raw)
        return _finish(user, device)

    @http.route('/api/v1/auth/device', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def remember_device(self, **payload):
        """Finish a password step with the remembered device of this browser instead of a code."""
        require_exact(payload, set(), set())
        user = _pending_user(lock=True)
        token = request.httprequest.cookies.get(DEVICE_COOKIE)
        device = request.env['liwan.access.service']._liwan_devices()._liwan_usable(token)
        if not device or device.user_id.id != user.id:
            _clear_device_cookie()
            return _refusal('invalid_device')
        return _finish(user, device)


def _set_device_cookie(raw):
    """Set the opaque device token as an httponly cookie for the auth endpoints only."""
    secure = request.httprequest.scheme == 'https'
    request.future_response.set_cookie(
        DEVICE_COOKIE, raw, max_age=DEVICE_COOKIE_MAX_AGE, path=DEVICE_COOKIE_PATH,
        httponly=True, samesite='Lax', secure=secure, cookie_type='required',
    )


def _clear_device_cookie():
    request.future_response.set_cookie(
        DEVICE_COOKIE, '', max_age=0, path=DEVICE_COOKIE_PATH, httponly=True, samesite='Lax',
        cookie_type='required',
    )
