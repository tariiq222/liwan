# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Connecting an oauth provider account: the authorization redirect and its callback.

The state carries the company, the signed-in user, the provider, the uses that asked for the connection,
the host and an expiry, signed with the provider app's secret. The app secret is shared by every tenant of a
shared deployment, so the callback also refuses a state minted for another host. Tokens are stored encrypted
and never appear in a redirect.
"""
import base64
import binascii
import hashlib
import hmac
import json
import time

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.controllers.helpers import (
    check_fields,
    find_connection,
    holds_manage,
    offered_providers,
    reject,
)
from odoo.addons.liwan_integrations_sa.models.constants import (
    AUTH_OAUTH,
    FEATURE,
    MANAGE,
    STATE_TTL,
)
from odoo.addons.liwan_integrations_sa.models.errors import AccountTaken
from odoo.addons.liwan_integrations_sa.providers import errors

SETTINGS_PATH = '/settings/integrations'
STATE_INVALID = 'this connection request is not valid'


def _state_signature(client_secret, payload):
    return hmac.new(client_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def encode_state(config, values):
    """The signed state of one connection attempt: base64url JSON, a dot, its HMAC-SHA256."""
    payload = base64.urlsafe_b64encode(
        json.dumps(values, separators=(',', ':'), sort_keys=True).encode(),
    ).decode().rstrip('=')
    return f'{payload}.{_state_signature(config.client_secret, payload)}'


def _request_host():
    """The host this request arrived on, without its port: what a state is minted for and checked against."""
    return request.httprequest.host.partition(':')[0]


def _is_count(value, minimum):
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def decode_state(config, state, now):
    """The values of a state this app signed and that has not expired; 403 otherwise."""
    payload, _, signature = (state or '').partition('.')
    # A query string decodes to latin-1, so the signature may carry bytes above 0x7F; comparing it
    # with the ASCII digest raises instead of refusing the state.
    if not payload or not signature or not signature.isascii() or not hmac.compare_digest(
        _state_signature(config.client_secret, payload), signature,
    ):
        raise ApiError(403, 'forbidden', STATE_INVALID)
    try:
        values = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (binascii.Error, ValueError):
        raise ApiError(403, 'forbidden', STATE_INVALID) from None
    valid = (
        isinstance(values, dict)
        and _is_count(values.get('c'), 1) and _is_count(values.get('u'), 1)
        and _is_count(values.get('x'), 0) and values['x'] >= now
        and isinstance(values.get('p'), str) and isinstance(values.get('h'), str)
        and isinstance(values.get('us'), list) and all(isinstance(use, str) for use in values['us'])
    )
    if not valid:
        raise ApiError(403, 'forbidden', STATE_INVALID)
    return values


def _redirect(provider, **query):
    pairs = '&'.join(f'{key}={value}' for key, value in {'provider': provider, **query}.items())
    return request.redirect(f'{SETTINGS_PATH}?{pairs}', code=302)


def _oauth_provider(code):
    """The module of an available oauth provider; 404 for any other code."""
    offered = offered_providers().get(code)
    if not offered or offered[0]['auth'] != AUTH_OAUTH:
        raise ApiError(404, 'not_found', 'record does not exist')
    return providers.MODULES[code]


def _use_scopes(provider, use_keys):
    """The scopes the named uses need, each use being an open one of ``provider``; 422 otherwise."""
    open_uses = {use['key']: use for use in request.env['liwan.integration.registry']._liwan_open_uses()}
    scopes = set()
    for key in use_keys:
        use = open_uses.get(key)
        if not use or use['provider'] != provider:
            reject(f'{key!r} is not an available use of this provider', 'uses')
        scopes |= set(use['scopes'])
    return scopes


class IntegrationOAuthController(http.Controller):

    @http.route('/api/v1/integrations/oauth/<string:provider>/start', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def start(self, provider, **payload):
        """The signed authorization URL of a new connection, or of one being connected again."""
        module = _oauth_provider(provider)
        check_fields(payload, {'uses', 'connection_id'}, required=('uses',))
        uses = payload['uses']
        if not isinstance(uses, list) or not uses or not all(isinstance(use, str) for use in uses):
            reject('uses must be a list of use keys', 'uses')
        _use_scopes(provider, uses)
        if payload.get('connection_id') is not None:
            connection = find_connection(payload['connection_id'])
            if connection.provider != provider:
                reject('connection_id must name a connection of this provider', 'connection_id')
        config = request.env['liwan.integration.connection']._liwan_oauth_config_of(provider)
        state = encode_state(config, {
            'c': request.env.company.id,
            'u': request.env.user.id,
            'p': provider,
            'us': sorted(set(uses)),
            'h': _request_host(),
            'x': int(time.time()) + int(STATE_TTL.total_seconds()),
        })
        return {'authorize_url': module.authorize_url(config, state)}

    @http.route('/api/v1/integrations/oauth/<string:provider>/callback', type='http', auth='user', methods=['GET'],
                csrf=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(MANAGE)
    def callback(self, provider, code=None, state=None, **_):
        """Exchange the authorization code and connect the account the administrator chose."""
        module = _oauth_provider(provider)
        try:
            config = request.env['liwan.integration.connection']._liwan_oauth_config_of(provider)
        except LiwanAccessRule:
            return _redirect(provider, error='not_configured')
        try:
            values = decode_state(config, state, int(time.time()))
        except ApiError:
            return _redirect(provider, error='invalid_state')
        company = request.env['res.company'].browse(values['c'])
        # The app secret is shared by every tenant of a shared deployment, so only the host proves the state
        # was minted for this tenant.
        if (
            values['p'] != provider or values['h'] != _request_host() or values['u'] != request.env.user.id
            or company != request.env.company or not holds_manage(company)
        ):
            return _redirect(provider, error='invalid_state')
        if not code:
            return _redirect(provider, error='denied')
        try:
            required = _use_scopes(provider, values['us'])
        except ApiError:
            return _redirect(provider, error='invalid_state')
        try:
            grant = module.exchange_code(config, code)
            # Every needed scope must arrive: a grant of optional scopes that omits one is not a superset.
            if not grant.scopes >= required:
                return _redirect(provider, error='scopes_missing')
            label = module.probe(grant.open_id, grant.access_token)
        except errors.ProviderError:
            return _redirect(provider, error='rejected')
        try:
            with request.env.cr.savepoint():
                self._connection_of(company, provider, grant.open_id)._liwan_oauth_store(grant, label)
        except AccountTaken:
            return _redirect(provider, error='account_taken')
        return _redirect(provider, result='connected')

    @staticmethod
    def _connection_of(company, provider, external_id):
        """The company's connection to this account (reconnecting it), or a new one: an account switch adds a second."""
        Connection = request.env['liwan.integration.connection']
        connection = Connection.search([
            ('company_id', '=', company.id), ('provider', '=', provider), ('external_id', '=', external_id),
        ], limit=1)
        return connection or Connection.create({'company_id': company.id, 'provider': provider, 'external_id': external_id})
