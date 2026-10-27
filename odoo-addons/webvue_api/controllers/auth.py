# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError, api_handler
from odoo.addons.webvue_api.serializers.user import dump_me
from odoo.addons.webvue_platform.models.entitlement_service import WebVueTenantSuspended


class AuthController(http.Controller):

    @http.route('/api/v1/auth/totp', type='json2', auth='public', methods=['POST'], readonly=False)
    @api_handler
    def totp(self, code=None):
        pre_uid = request.session.get('pre_uid')
        if not pre_uid:
            raise ApiError(401, 'no_pending_login', "No login is pending two-factor verification")

        try:
            token = int(re.sub(r'\s', '', str(code or '')))
        except (TypeError, ValueError):
            raise ApiError(422, 'invalid_code_format', "Invalid authentication code format")

        user = request.env['res.users'].browse(pre_uid)
        service = request.env['webvue.entitlement.service'].sudo()
        try:
            service._webvue_assert_login_allowed(user)
        except WebVueTenantSuspended:
            raise ApiError(403, 'tenant_suspended', 'this tenant is suspended') from None
        except AccessDenied:
            raise ApiError(403, 'login_refused', 'this account may not sign in') from None
        try:
            with user._assert_can_auth(user=user.id):
                credentials = {'type': user._mfa_type(), 'token': token}
                user._check_credentials(credentials, {'interactive': True})
        except AccessDenied:
            raise ApiError(401, 'invalid_code', "Verification failed, please double-check the 6-digit code") from None

        request.session.finalize(request.env)
        request.update_env(user=request.session.uid)
        return dump_me(request.env.user)
