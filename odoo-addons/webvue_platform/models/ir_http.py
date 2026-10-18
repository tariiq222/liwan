# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from werkzeug.exceptions import NotFound

from odoo import models
from odoo.exceptions import AccessDenied
from odoo.http import request

# Nobody uses Odoo's web client or its generic RPC: the Nuxt app talks to /api/v1
# and to the few stock routes listed below. Stock endpoints such as
# /web/dataset/call_kw, /json/2 and /doc skip the per-capability gates of /api/v1,
# so a signed-in request (session or API key) reaches nothing outside this
# allowlist; everything else is a 404. Mirror of deploy/shared/guard.mjs.

# Routes that stay open to a session the tenant lifecycle would otherwise log out.
SESSION_ALLOWLIST = frozenset({
    '/web/session/authenticate',
    '/web/session/destroy',
    '/web/health',
})
# Static files and the attachment/image routes, also exempt from that logout.
SESSION_PREFIXES = (
    '/web/assets/',
    '/web/static/',
    '/web/content',
    '/web/image',
)
# Credentials travel in the body of these routes (auth='none'), so they are closed
# even to requests without a session.
RPC_PREFIXES = ('/xmlrpc', '/jsonrpc')
# The Odoo routes the Nuxt app calls itself (login state, bus version probe, logo).
SESSION_ROUTES = frozenset({
    *SESSION_ALLOWLIST,
    '/web/session/get_session_info',
    '/web/binary/company_logo',
})
# WebVue's own Odoo routes: /api/v1 and the customer-commercial stub (R5 exception).
API_PREFIXES = ('/api/v1/', '/api/commercial/v1/')
# The app's own prefixes: those routes, the websocket and Odoo's static assets.
SESSION_ROUTE_PREFIXES = (*API_PREFIXES, '/websocket', '/web/assets/', '/web/static/')
# The exact image URLs the app builds: employee avatar and company favicon.
SESSION_IMAGE_PATH = re.compile(
    r'^/web/image/(?:hr\.employee/[1-9][0-9]{0,9}/avatar_128|res\.company/[1-9][0-9]{0,9}/logo/32x32)$',
)
# Attachment downloads by id only. Residual risk: any attachment readable by the
# user's ACLs can be fetched by id; the full fix is an /api/v1 download route.
SESSION_ATTACHMENT_PATH = re.compile(r'^/web/content/[0-9]+$')


def _session_may_reach(path):
    return (
        path in SESSION_ROUTES
        or path.startswith(SESSION_ROUTE_PREFIXES)
        or bool(SESSION_IMAGE_PATH.match(path))
        or bool(SESSION_ATTACHMENT_PATH.match(path))
    )


class WebVuePlatformIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _authenticate_explicit(cls, auth):
        super()._authenticate_explicit(auth)
        path = request.httprequest.path
        if path.startswith(RPC_PREFIXES):
            raise NotFound()
        user = request.env.user
        # auth='none' routes (/odoo) clear the environment user; the session still knows it.
        if not (request.session.uid or (user and not user._is_public())):
            return
        exempt = path in SESSION_ALLOWLIST or path.startswith(SESSION_PREFIXES + API_PREFIXES)
        if not exempt and user and not user._is_public():
            service = request.env['webvue.entitlement.service'].sudo()
            if service._webvue_session_forbidden(user):
                request.session.logout(keep_db=True)
                raise AccessDenied()
        if not _session_may_reach(path):
            raise NotFound()
