# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.liwan_api.controllers.access_admin import require_exact
from odoo.addons.liwan_api.controllers.common import ApiError, api_handler
from odoo.addons.liwan_api.serializers.user import dump_me
from odoo.addons.liwan_core.models.login_code import CHANNELS
from odoo.addons.liwan_platform.models.entitlement_service import LiwanTenantSuspended

NO_PENDING = (401, 'no_pending_login', 'No sign-in is pending a second step')
# The remembered-device token of one browser: an opaque secret, never the session cookie.
DEVICE_COOKIE = 'liwan_device'
DEVICE_COOKIE_PATH = '/'
DEVICE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60
DEVICE_TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{20,256}$')
DOUBLE_STEP_REFUSALS = {
    'invalid_code': (401, 'invalid_code', 'Verification failed, please double-check the 6-digit code'),
    'invalid_code_format': (422, 'invalid_code_format', 'The code must be 6 digits'),
    'invalid_device': (401, 'invalid_device', 'This device is no longer remembered'),
    'channel_unavailable': (503, 'channel_unavailable', 'This channel is not available; use another one'),
    'invalid_channel': (422, 'invalid_channel', 'Unknown delivery channel'),
    'send_limit_reached': (429, 'send_limit_reached', 'Too many codes were sent for this account'),
    'daily_send_cap': (503, 'daily_send_cap', 'The daily code limit was reached; try again tomorrow'),
    'resend_cooldown': (429, 'resend_cooldown', 'Wait before asking for another code'),
}


def _refusal(code, resend_after=0):
    status, machine, message = DOUBLE_STEP_REFUSALS[code]
    details = {'resend_after': resend_after} if resend_after else None
    raise ApiError(status, machine, message, details=details)


def _pending_user():
    """The account a sign-in names: the pending one, else the signed-in caller.

    The second step always has a pending account. The same question ("which channels may this account
    use") is also asked about the signed-in caller, and both answers describe that one account only.
    """
    pre_uid = request.session.get('pre_uid')
    if pre_uid:
        return request.env(user=pre_uid)['res.users'].browse(pre_uid)
    user = request.env.user
    if user and not user._is_public():
        return user
    raise ApiError(*NO_PENDING)


def _assert_login_allowed(user):
    """The same lifecycle gate the password step applies, answered with its own machine codes."""
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
    request.session.finalize(request.env)
    request.update_env(user=request.session.uid)
    body = dump_me(request.env.user)
    body['remembered'] = device is not None
    return body


class AuthController(http.Controller):

    @http.route('/api/v1/auth/channels', type='json2', auth='public', methods=['GET'], readonly=True)
    @api_handler
    def channels(self):
        """What a pending sign-in may use: SMS only when a provider is configured, email always."""
        user = _pending_user()
        gateway = request.env['liwan.sms.gateway']
        available = [channel for channel in CHANNELS if channel != 'sms' or gateway._liwan_sms_available()]
        return {
            'channels': available,
            'sms_available': gateway._liwan_sms_available(),
            'has_mobile': bool(user.liwan_mobile),
            'has_email': bool(user.email),
        }

    @http.route('/api/v1/auth/code', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def send_code(self, **payload):
        require_exact(payload, {'channel'}, {'channel'})
        user = _pending_user()
        channel = payload['channel']
        if channel not in CHANNELS:
            raise ApiError(422, 'invalid_channel', "channel must be 'sms' or 'email'", field='channel')
        _assert_login_allowed(user)
        # The code table is system-only; the access service is its single documented reader/writer.
        outcome = request.env['liwan.access.service']._liwan_codes()._liwan_issue(user, channel)
        if outcome.error:
            _refusal(outcome.error, outcome.resend_after)
        return {
            'channel': outcome.channel,
            'destination': outcome.destination,
            'resend_after': outcome.resend_after,
        }

    @http.route('/api/v1/auth/verify', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def verify(self, **payload):
        require_exact(payload, {'code', 'remember', 'label'}, {'code'})
        user = _pending_user()
        _assert_login_allowed(user)
        error = request.env['liwan.access.service']._liwan_codes()._liwan_verify(user, payload['code'])
        if error:
            _refusal(error)
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
        user = _pending_user()
        _assert_login_allowed(user)
        token = request.httprequest.cookies.get(DEVICE_COOKIE)
        device = request.env['liwan.access.service']._liwan_devices()._liwan_usable(token)
        if not device or device.user_id.id != user.id:
            _clear_device_cookie()
            _refusal('invalid_device')
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
