# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.access_admin import require_exact
from odoo.addons.liwan_api.controllers.common import ApiError, api_handler

PURPOSES = ('invite', 'reset')


def _text(payload, field):
    value = payload[field]
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be a string', field=field)
    return value


class AccountPublicController(http.Controller):
    """The emailed-link pages of an account, for visitors with no session: the single-use token is the authorization."""

    @http.route(
        '/api/v1/public/account/token', type='json2', auth='public', methods=['POST'],
        readonly=True, save_session=False,
    )
    @api_handler
    def check_token(self, **payload):
        require_exact(payload, {'token', 'purpose'}, {'token', 'purpose'})
        purpose = _text(payload, 'purpose')
        if purpose not in PURPOSES:
            raise ApiError(422, 'invalid', 'unknown purpose', field='purpose')
        service = request.env['liwan.access.service']
        return {'usable': service._liwan_token_usable(_text(payload, 'token'), purpose)}

    @http.route(
        '/api/v1/public/account/invitation/accept', type='json2', auth='public', methods=['POST'],
        readonly=False, save_session=False,
    )
    @api_handler
    def accept_invitation(self, **payload):
        require_exact(payload, {'token', 'mobile', 'password'}, {'token', 'mobile', 'password'})
        user = request.env['liwan.access.service']._liwan_accept_invitation(
            _text(payload, 'token'), payload['mobile'], payload['password'],
        )
        return {'login': user.login, 'read_only': bool(user.liwan_read_only)}

    @http.route(
        '/api/v1/public/account/password/forgot', type='json2', auth='public', methods=['POST'],
        readonly=False, save_session=False,
    )
    @api_handler
    def forgot_password(self, **payload):
        require_exact(payload, {'email'}, {'email'})
        request.env['liwan.access.service']._liwan_request_password_reset(payload['email'])
        return request.make_json_response({}, status=202)

    @http.route(
        '/api/v1/public/account/password/reset', type='json2', auth='public', methods=['POST'],
        readonly=False, save_session=False,
    )
    @api_handler
    def reset_password(self, **payload):
        require_exact(payload, {'token', 'password'}, {'token', 'password'})
        user = request.env['liwan.access.service']._liwan_reset_password_with_token(
            _text(payload, 'token'), payload['password'],
        )
        return {'login': user.login}
