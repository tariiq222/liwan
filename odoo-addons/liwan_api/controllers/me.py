# Part of Odoo. See LICENSE file for full copyright and licensing details.
import pytz

from odoo import http
from odoo.exceptions import AccessDenied
from odoo.http import request

from odoo.addons.liwan_api.controllers.auth import DEVICE_COOKIE
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    chooses_company,
    clear_security_caches_after_commit,
    parse_positive_int,
    select_working_company,
)
from odoo.addons.liwan_api.models.res_users import (
    APPEARANCE_MODES,
    FONT_SIZES,
    fresh_session_token,
)
from odoo.addons.liwan_api.serializers.user import dump_device, dump_me

PROFILE_FIELDS = ('lang', 'tz')


def _language(value):
    """The locale code of VALUE; 422 when it is not installed. Arabic is the product default."""
    installed = {code for code, _name in request.env['res.lang'].get_installed()}
    if not isinstance(value, str) or value not in installed:
        raise ApiError(422, 'invalid', 'lang must be an installed locale', field='lang')
    return value


def _timezone(value):
    """The IANA zone of VALUE, or 422. An empty value clears the stored zone."""
    if not isinstance(value, str) and value is not None and value is not False:
        raise ApiError(422, 'invalid', 'tz must be an IANA time zone', field='tz')
    if not value:
        return False
    try:
        pytz.timezone(value)
    except pytz.UnknownTimeZoneError:
        raise ApiError(422, 'invalid', 'tz must be an IANA time zone', field='tz') from None
    return value


class MeController(http.Controller):

    @http.route('/api/v1/me', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def me(self):
        return dump_me(request.env.user)

    @http.route('/api/v1/me/company', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @chooses_company
    def switch_company(self, company_id=None, **extra):
        """Set the company this session works in and answer the new ``me``.

        Only an active membership qualifies. Any other company answers 404 exactly as a company that does not
        exist, so the answer says nothing about companies the caller is not part of. Nothing is written on the
        user: the home company, the seat and the employee link stay where they are.
        """
        if extra:
            field = next(iter(extra))
            raise ApiError(422, 'invalid', f"field {field!r} is not accepted", field=field)
        select_working_company(parse_positive_int(company_id, 'company_id'))
        return dump_me(request.env.user)

    @http.route('/api/v1/me/profile', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_profile(self, **payload):
        """Save the account holder's own language and time zone on the user record.

        Both are stock ``res.users`` self-writable fields, so the owner needs no capability; the
        values are validated against the installed languages and the IANA zone list. Mail and
        notifications then render in the stored language and zone, not in a cookie.
        """
        unknown = set(payload) - set(PROFILE_FIELDS)
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
        if not payload:
            raise ApiError(422, 'invalid', 'no fields to update')
        vals = {}
        if 'lang' in payload:
            vals['lang'] = _language(payload['lang'])
        if 'tz' in payload:
            vals['tz'] = _timezone(payload['tz'])
        request.env.user.write(vals)
        return dump_me(request.env.user)

    @http.route('/api/v1/me/devices', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def devices(self):
        """The caller's own usable remembered devices, newest first, without any token."""
        service = request.env['liwan.access.service']
        records = service._liwan_devices().browse(service._liwan_remembered_devices(request.env.user))
        return {'items': [dump_device(record) for record in records], 'total': len(records)}

    @http.route('/api/v1/me/devices', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def forget_devices(self):
        """Forget the caller's remembered devices except the browser making this request.

        The browser in use is named by its own device cookie, so the holder is never signed out of the
        convenience they are using. Answers the ids that are still remembered.
        """
        service = request.env['liwan.access.service']
        keep = service._liwan_devices()._liwan_usable(request.httprequest.cookies.get(DEVICE_COOKIE))
        service._liwan_forget_devices(request.env.user, keep=keep)
        return {'device_ids': service._liwan_remembered_devices(request.env.user)}

    @http.route('/api/v1/me/password', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def change_password(self, current=None, new=None, **extra):
        if extra:
            field = next(iter(extra))
            raise ApiError(422, 'invalid', f"field {field!r} is not accepted", field=field)
        if not isinstance(current, str) or not current:
            raise ApiError(422, 'wrong_password', 'current password is required', field='current')
        request.env['liwan.access.service']._liwan_check_password(new, field='new')

        try:
            request.env.user.change_password(current, new)
        except AccessDenied:
            raise ApiError(422, 'wrong_password', 'current password is incorrect', field='current') from None

        request.env.user.flush_recordset(['password'])
        request.session.session_token = fresh_session_token(request.env.user, request.session.sid)
        clear_security_caches_after_commit(request.env)
        return dump_me(request.env.user)

    @http.route('/api/v1/me/mobile', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_mobile(self, mobile=None, **extra):
        if extra:
            field = next(iter(extra))
            raise ApiError(422, 'invalid', f"field {field!r} is not accepted", field=field)
        request.env['liwan.access.service']._liwan_set_own_mobile(mobile)
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
            vals['liwan_appearance_mode'] = payload['mode']
        if 'font_size' in payload:
            if payload['font_size'] not in FONT_SIZES:
                raise ApiError(422, 'invalid', "font_size must be 'small', 'medium' or 'large'", field='font_size')
            vals['liwan_font_size'] = payload['font_size']
        # Self-writable fields: a user only ever changes their own preference.
        request.env.user.write(vals)
        return dump_me(request.env.user)
