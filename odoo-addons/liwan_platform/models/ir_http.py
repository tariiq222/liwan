# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from werkzeug.exceptions import NotFound, Unauthorized

from odoo import models
from odoo.exceptions import AccessDenied
from odoo.http import SessionExpiredException, request

# Nobody uses Odoo's web client or its generic RPC: the Nuxt app talks to /api/v1
# and to the few stock routes listed below. Stock endpoints such as
# /web/dataset/call_kw, /json/2 and /doc skip the per-capability gates of /api/v1,
# so every request, signed in (session or API key) or not, reaches nothing outside
# this allowlist; everything else is a 404. Mirror of deploy/shared/guard.mjs.

# Routes that stay open to a session the tenant lifecycle would otherwise log out.
SESSION_ALLOWLIST = frozenset({
    '/web/session/authenticate',
    '/web/session/destroy',
    '/web/health',
})
# Static files and the image routes, also exempt from that logout.
SESSION_PREFIXES = (
    '/web/assets/',
    '/web/static/',
    '/web/image',
)
# Credentials travel in the body of these routes (auth='none'); they are closed
# before any other rule.
RPC_PREFIXES = ('/xmlrpc', '/jsonrpc')
# LiwanOS's own Odoo routes: /api/v1 and the customer-commercial stub (R5 exception).
API_PREFIXES = ('/api/v1/', '/api/commercial/v1/')
# Odoo routes the Nuxt app calls itself (login state, bus version probe, logo) and
# the stateless QR/barcode image generator wkhtmltopdf fetches while it renders a
# report (the ZATCA QR of a Saudi invoice).
OPEN_ROUTES = frozenset({
    *SESSION_ALLOWLIST,
    '/web/session/get_session_info',
    '/web/binary/company_logo',
    '/report/barcode',
    '/report/barcode/',
})
# Open prefixes: LiwanOS's own routes, the websocket and Odoo's static assets.
OPEN_PREFIXES = (*API_PREFIXES, '/websocket', '/web/assets/', '/web/static/')
# The exact image URLs the app builds: employee avatar (no query) and company
# favicon (a version key only), as in the shared edge.
AVATAR_PATH = re.compile(r'^/web/image/hr\.employee/[1-9][0-9]{0,9}/avatar_128$')
FAVICON_PATH = re.compile(r'^/web/image/res\.company/[1-9][0-9]{0,9}/logo/32x32$')
VERSION_VALUE = re.compile(r'^(?:0|[0-9]{20})-[a-f0-9]{12}$')
# Attachments are never served by Odoo's /web/content: each owning application streams
# its own files from /api/v1/.../attachments/<id>/download after its capability check.
LOGO_QUERY_KEYS = frozenset({'company', 'v'})


def _query_keys(httprequest):
    return set(httprequest.args)


def _may_reach(httprequest):
    path = httprequest.path
    keys = _query_keys(httprequest)
    if AVATAR_PATH.match(path):
        return not keys
    if FAVICON_PATH.match(path):
        values = httprequest.args.getlist('v')
        return keys == {'v'} and len(values) == 1 and bool(VERSION_VALUE.match(values[0]))
    if path == '/web/binary/company_logo':
        return keys <= LOGO_QUERY_KEYS
    return path in OPEN_ROUTES or path.startswith(OPEN_PREFIXES)


class LiwanPlatformIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _auth_method_user(cls):
        """Answer 401 ``session_required`` on /api/v1 without a session; stock Odoo answers 403.

        The web app reads 401 as "sign in again" and 403 as "not allowed", so a visitor with
        no (or an ended) session must never look like a refused signed-in user.
        """
        try:
            super()._auth_method_user()
        except SessionExpiredException:
            if not request.httprequest.path.startswith(API_PREFIXES):
                raise
            response = request.make_json_response(
                {'code': 'session_required', 'message': 'A valid session is required.'}, status=401,
            )
            raise Unauthorized(response=response) from None

    @classmethod
    def _authenticate_explicit(cls, auth):
        super()._authenticate_explicit(auth)
        httprequest = request.httprequest
        path = httprequest.path
        if path.startswith(RPC_PREFIXES):
            raise NotFound()
        user = request.env.user
        has_user = bool(user) and not user._is_public()
        exempt = path in SESSION_ALLOWLIST or path.startswith(SESSION_PREFIXES + API_PREFIXES)
        if has_user and not exempt:
            service = request.env['liwan.entitlement.service']
            if service._liwan_session_forbidden(user):
                request.session.logout(keep_db=True)
                raise AccessDenied()
        if not _may_reach(httprequest):
            raise NotFound()
