# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    MIN_PASSWORD_LENGTH,
    ApiError,
    api_handler,
    clear_security_caches_after_commit,
    fresh_session_token,
)
from odoo.addons.nasq_api.models.res_users import APPEARANCE_MODES, FONT_SIZES
from odoo.addons.nasq_api.serializers.user import dump_me


class MeController(http.Controller):

    @http.route('/api/v1/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
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
        request.session.session_token = fresh_session_token(request.env.user, request.session.sid)
        clear_security_caches_after_commit(request.env)
        return dump_me(request.env.user)

    @http.route('/api/v1/me/appearance', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_appearance(self, **payload):
        unknown = set(payload) - {'mode', 'font_size'}
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
        if not payload:
            raise ApiError(422, 'invalid', "no fields to update")
        vals = {}
        if 'mode' in payload:
            if payload['mode'] not in APPEARANCE_MODES:
                raise ApiError(422, 'invalid', "mode must be 'light', 'cream' or 'dark'", field='mode')
            vals['nasq_appearance_mode'] = payload['mode']
        if 'font_size' in payload:
            if payload['font_size'] not in FONT_SIZES:
                raise ApiError(422, 'invalid', "font_size must be 'small', 'medium' or 'large'", field='font_size')
            vals['nasq_font_size'] = payload['font_size']
        # Self-writable fields: a user only ever changes their own preference.
        request.env.user.write(vals)
        return dump_me(request.env.user)
