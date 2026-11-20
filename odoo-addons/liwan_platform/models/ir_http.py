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
# Odoo routes the Nuxt app calls itself (login state, bus version probe, logo).
OPEN_ROUTES = frozenset({
    *SESSION_ALLOWLIST,
    '/web/session/get_session_info',
    '/web/binary/company_logo',
})
# Open prefixes: LiwanOS's own routes, the websocket and Odoo's static assets.
OPEN_PREFIXES = (*API_PREFIXES, '/websocket', '/web/assets/', '/web/static/')
# The exact image URLs the app builds: employee avatar (no query) and company
# favicon (a version key only), as in the shared edge.
AVATAR_PATH = re.compile(r'^/web/image/hr\.employee/[1-9][0-9]{0,9}/avatar_128$')
FAVICON_PATH = re.compile(r'^/web/image/res\.company/[1-9][0-9]{0,9}/logo/32x32$')
# The UI language (the web app's ``liwan-locale`` cookie, sent by the Nuxt proxy) selects the language of
# the server text of one /api/v1 request. Only these two values are honoured; the stored user language
# and the session are never written.
UI_LOCALE_HEADER = 'X-Liwan-Ui-Locale'
UI_LOCALES = {'ar': 'ar_001', 'en': 'en_US'}
# The favicon version is the 12-hex content hash of the logo (``_logo_version`` in liwan_api), never a write time.
VERSION_VALUE = re.compile(r'^[a-f0-9]{12}$')
# Attachments are never served by Odoo's /web/content: each owning application streams
# its own files from /api/v1/.../attachments/<id>/download after its capability check.
LOGO_QUERY_KEYS = frozenset({'company', 'v'})


# A bearer API key authenticates a request on no route by default: an application that has a machine caller registers its
# one exact path by extending ``_liwan_bearer_routes``. Every other route with ``auth='bearer'`` (Odoo's own ``/json/2``
# among them) is a 404 before the key is even looked at.


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


def _guard_closes(httprequest):
    """True for a path the guard does not open: the RPC prefixes and anything ``_may_reach`` refuses."""
    return httprequest.path.startswith(RPC_PREFIXES) or not _may_reach(httprequest)


class LiwanPlatformIrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _liwan_bearer_routes(cls):
        """The exact paths a bearer API key may reach; an application adds its own through ``super()``."""
        return frozenset()

    @classmethod
    def _auth_method_bearer(cls):
        """Answer a missing or wrong key on a registered route with the JSON 401 the web app reads."""
        try:
            super()._auth_method_bearer()
        except Unauthorized:
            response = request.make_json_response(
                {'code': 'unauthorized', 'message': 'A valid API key is required.'}, status=401,
            )
            raise Unauthorized(response=response) from None

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
    def _match(cls, path_info):
        """Match no route at all for a path the guard does not open, so it answers a bare 404.

        Odoo calls this hook once per request, before it picks a dispatcher or authenticates. Deciding here
        keeps the answer the same for every caller and every route type: a ``jsonrpc`` route would answer
        a refused request with HTTP 200 and the traceback in ``error.data.debug``, ``auth='user'`` would
        raise ``SessionExpiredException`` for a visitor, and a wrong ``Content-Type`` would answer 415 and
        name the route. An unmatched path takes ``_serve_fallback``, which refuses it as well.

        The decision is about the request being served, never ``path_info``: other callers (``http_routing``
        building a URL for another language) pass a different URL, and the gate stays per request. Outside a
        request there is nothing to decide. The manifest dependency on ``http_routing`` places this override
        above its ``_match``, which would otherwise redirect a closed path by language before the guard runs.
        """
        if request and _guard_closes(request.httprequest):
            raise NotFound()
        return super()._match(path_info)

    @classmethod
    def _authenticate_explicit(cls, auth):
        # Bearer: exact match only (no prefix, no trailing slash, no other case). A foreign path never reaches the key check.
        if auth == 'bearer' and request.httprequest.path not in cls._liwan_bearer_routes():
            raise NotFound()
        super()._authenticate_explicit(auth)
        user = request.env.user
        has_user = bool(user) and not user._is_public()
        path = request.httprequest.path
        exempt = path in SESSION_ALLOWLIST or path.startswith(SESSION_PREFIXES + API_PREFIXES)
        if has_user and not exempt:
            service = request.env['liwan.entitlement.service']
            if service._liwan_session_forbidden(user):
                request.session.logout(keep_db=True)
                raise AccessDenied()

    @classmethod
    def _serve_fallback(cls):
        """Serve nothing on a path the guard closes, and answer an unmatched /api/v1 path with the JSON 404.

        A closed path that matches a route lands here after ``_match`` refused it. Stock Odoo would look up a
        binary attachment whose ``url`` is that path (with ``sudo()``), so a closed path never reaches it.

        Stock Odoo renders its HTML error page when the ``<int:...>`` converter rejects an id, before
        ``api_handler`` can run. The web app reads the body ``code``, so an API path never gets HTML.
        """
        if _guard_closes(request.httprequest):
            return None
        response = super()._serve_fallback()
        if response is None and request.httprequest.path.startswith(API_PREFIXES):
            return request.make_json_response({'code': 'not_found', 'message': 'Record does not exist'}, status=404)
        return response

    @classmethod
    def _pre_dispatch(cls, rule, args):
        super()._pre_dispatch(rule, args)
        httprequest = request.httprequest
        if not httprequest.path.startswith(API_PREFIXES):
            return
        code = UI_LOCALES.get((httprequest.headers.get(UI_LOCALE_HEADER) or '').strip().lower())
        installed = {lang for lang, _name in request.env['res.lang'].get_installed()}
        if code in installed:
            request.update_context(lang=code)
