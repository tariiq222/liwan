# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    MIN_PASSWORD_LENGTH,
    ApiError,
    api_handler,
)
from odoo.addons.nasq_api.serializers.user import dump_me


class MeController(http.Controller):

    @http.route('/api/v1/me', type='json2', auth='user', methods=['GET'], readonly=True)
    def me(self):
        return dump_me(request.env.user)

    @http.route('/api/v1/me/password', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def change_password(self, current=None, new=None, **extra):
        if extra:
            field = next(iter(extra))
            raise ApiError(422, 'invalid', f"field {field!r} is not accepted", field=field)
        if not isinstance(current, str) or not current:
            raise ApiError(422, 'wrong_password', 'current password is required', field='current')
        if not isinstance(new, str) or len(new.strip()) < MIN_PASSWORD_LENGTH:
            raise ApiError(
                422,
                'weak_password',
                f'new password must be at least {MIN_PASSWORD_LENGTH} characters',
                field='new',
            )

        try:
            request.env.user.change_password(current, new)
        except AccessDenied:
            raise ApiError(422, 'wrong_password', 'current password is incorrect', field='current') from None

        request.env.user.flush_recordset(['password'])
        request.session.session_token = request.env.user._compute_session_token(request.session.sid)
        return dump_me(request.env.user)
