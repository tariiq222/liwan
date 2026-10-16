# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessDenied
from odoo.http import request

SESSION_ALLOWLIST = frozenset({
    '/web/session/authenticate',
    '/web/session/destroy',
    '/web/health',
    '/api/v1/branding',
})
SESSION_PREFIXES = (
    '/web/assets/',
    '/web/static/',
    '/web/webclient/',
    '/web/content',
    '/web/image',
)


class WebVuePlatformIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _authenticate_explicit(cls, auth):
        super()._authenticate_explicit(auth)
        path = request.httprequest.path
        if path in SESSION_ALLOWLIST or path.startswith(SESSION_PREFIXES):
            return
        if path.startswith('/api/v1'):
            return
        user = request.env.user
        if not user or user._is_public():
            return
        service = request.env['webvue.entitlement.service'].sudo()
        if service._webvue_session_forbidden(user):
            request.session.logout(keep_db=True)
            raise AccessDenied()
