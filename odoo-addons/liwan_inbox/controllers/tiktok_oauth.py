# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok account connection: the authorization redirect and its callback.

The state carries the tenant, the signed-in user, the channel to reconnect (or 0), the channel name,
the department, the tenant host and an expiry, signed with the app secret (D13). The relay verifies the
same signature before it forwards the callback to the owning tenant, so the tenant host in the state is
never trusted from the query string. Tokens are stored encrypted and never appear in a redirect.
"""
import base64
import binascii
import hashlib
import hmac
import json
import time

from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.controllers.helpers import (
    check_fields,
    find_one,
    get_channel,
    holds,
    parse_text,
    reject,
)
from odoo.addons.liwan_inbox.models.access_service import MANAGE_CHANNELS
from odoo.addons.liwan_inbox.models.constants import (
    TIKTOK_FEATURE,
    TIKTOK_REQUIRED_SCOPES,
    TIKTOK_STATE_TTL,
)

SETTINGS_PATH = '/settings/apps/inbox'
CHANNEL_PATH = SETTINGS_PATH + '/channels/%d'
STATE_INVALID = 'this connection request is not valid'
EXCHANGE_FAILED = 'the authorization code could not be exchanged'
PROFILE_FAILED = 'the TikTok account could not be read'


def _state_signature(client_secret, payload):
    return hmac.new(client_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def encode_state(config, values):
    """The signed state of one connection attempt: base64url JSON, a dot, its HMAC-SHA256."""
    payload = base64.urlsafe_b64encode(
        json.dumps(values, separators=(',', ':'), sort_keys=True).encode(),
    ).decode().rstrip('=')
    return f'{payload}.{_state_signature(config.client_secret, payload)}'


def _is_count(value, minimum):
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def decode_state(config, state, now):
    """The values of a state this app signed and that has not expired; 403 otherwise."""
    payload, _, signature = (state or '').partition('.')
    if not payload or not signature or not hmac.compare_digest(
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
        and _is_count(values.get('ch'), 0) and _is_count(values.get('d'), 0)
        and _is_count(values.get('x'), 0) and values['x'] >= now
        and isinstance(values.get('n'), str) and isinstance(values.get('h'), str)
    )
    if not valid:
        raise ApiError(403, 'forbidden', STATE_INVALID)
    return values


def _settings_redirect(reason):
    return request.redirect(f'{SETTINGS_PATH}?tiktok_error={reason}', code=302)


def _channel_redirect(channel):
    return request.redirect(CHANNEL_PATH % channel.id, code=302)


class TikTokOAuthController(http.Controller):

    @http.route('/api/v1/inbox/channels/tiktok/connect', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE)
    @requires_capability(MANAGE_CHANNELS)
    def connect(self, **payload):
        """The signed TikTok authorization URL of a new channel or of a channel being reconnected."""
        channel = False
        if payload.get('channel_id'):
            check_fields(payload, {'name', 'department_id', 'channel_id'})
            channel = get_channel(payload['channel_id'], MANAGE_CHANNELS)
            if channel.kind != 'tiktok' or channel.owner_company_id != request.env.company:
                reject('channel_id must name a TikTok channel of the current company', 'channel_id')
        else:
            check_fields(payload, {'name', 'department_id', 'channel_id'}, required=('name',))
        if not holds(MANAGE_CHANNELS, request.env.company):
            raise ApiError(403, 'forbidden', f'{MANAGE_CHANNELS} capability is required in the current company')
        department = (
            find_one('liwan.inbox.department', payload['department_id'], 'department_id')
            if payload.get('department_id')
            else (channel.department_id if channel else request.env['liwan.inbox.department'])
        )
        config = request.env['liwan.inbox.channel']._liwan_tiktok_config()
        state = encode_state(config, {
            'c': request.env.company.id,
            'u': request.env.user.id,
            'ch': channel.id if channel else 0,
            'n': parse_text(payload, 'name', 128) if 'name' in payload else channel.name,
            'd': department.id if department else 0,
            'h': request.httprequest.host.partition(':')[0],
            'x': int(time.time()) + int(TIKTOK_STATE_TTL.total_seconds()),
        })
        return {'authorize_url': tiktok.authorize_url(config, state)}

    @http.route('/api/v1/inbox/tiktok/callback', type='http', auth='user', methods=['GET'], csrf=False,
                save_session=False)
    @api_handler
    @requires_feature(TIKTOK_FEATURE)
    @requires_capability(MANAGE_CHANNELS)
    def callback(self, code=None, state=None, **_):
        """Exchange the authorization code and connect (or reconnect) the channel of the state."""
        config = request.env['liwan.inbox.channel']._liwan_tiktok_config()
        values = decode_state(config, state, int(time.time()))
        company = request.env['res.company'].browse(values['c'])
        if values['u'] != request.env.user.id or not company.exists() or not holds(MANAGE_CHANNELS, company):
            raise ApiError(403, 'forbidden', STATE_INVALID)
        channel = request.env['liwan.inbox.channel']
        if values['ch']:
            channel = self._reconnect_target(values['ch'], company)
        try:
            grant = tiktok.exchange_code(config, code or '')
        except errors.ProviderError:
            raise ApiError(422, 'invalid', EXCHANGE_FAILED) from None
        if grant.scopes < TIKTOK_REQUIRED_SCOPES:
            return _settings_redirect('inbox_tiktok_scopes_missing')
        bound = request.env['liwan.inbox.channel'].search([('tiktok_business_id', '=', grant.open_id)], limit=1)
        if bound and bound != channel:
            return _settings_redirect('inbox_tiktok_account_taken')
        try:
            profile = tiktok.business_profile(tiktok.Credentials(grant.open_id, grant.access_token))
        except errors.ProviderError:
            raise ApiError(422, 'invalid', PROFILE_FAILED) from None
        if channel:
            channel._liwan_tiktok_store(grant, profile)
        else:
            channel = self._create_channel(values, company, grant, profile)
            if not channel:
                return _settings_redirect('inbox_tiktok_account_taken')
        # A shared-SaaS tenant registers the account with the relay so deliveries reach it (D13); the
        # cron retries an unreachable relay, and a direct-webhook tenant makes no relay call at all.
        channel._liwan_tiktok_bind()
        # A connected account imports its history: the first connect, or a reconnect of one that never imported (D11).
        channel._liwan_tiktok_queue_first_sync()
        return _channel_redirect(channel)

    def _reconnect_target(self, channel_id, company):
        channel = request.env['liwan.inbox.channel'].search([('id', '=', channel_id)], limit=1)
        if not channel or channel.kind != 'tiktok' or channel.owner_company_id != company:
            raise ApiError(403, 'forbidden', STATE_INVALID)
        return channel

    def _create_channel(self, values, company, grant, profile):
        """The new channel, or nothing when another callback took the account first."""
        try:
            with request.env.cr.savepoint():
                channel = request.env['liwan.inbox.channel'].create({
                    'name': values['n'],
                    'kind': 'tiktok',
                    'owner_company_id': company.id,
                    'department_id': values['d'] or False,
                    'tiktok_business_id': grant.open_id,
                })
                channel._liwan_tiktok_store(grant, profile)
                request.env.flush_all()
        except UniqueViolation:
            # Two callbacks raced for the same business account: the second one reports it as taken.
            return request.env['liwan.inbox.channel']
        return channel
