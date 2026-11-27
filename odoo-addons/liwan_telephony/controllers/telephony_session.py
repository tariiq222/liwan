# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The browser session of one extension (design 4.1).

The route proves the feature, the capability and the company, then asks the company's agent for a registration
through ``liwan.telephony.agent``. The agent generates a new password for the extension and writes it to the Asterisk
realtime database, and the value reaches the browser once. Odoo stores nothing: the extension model has no password
field, and the reply is the only place the secret exists on this side.
"""
import re

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_telephony.models.agent_client import AGENT_BAD_ANSWER
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE

WS_URL_PATTERN = re.compile(r'^wss?://.+')
AUTH_USERNAME_MAX_LENGTH = 64
SESSION_MIN_SECONDS = 1
SESSION_MAX_SECONDS = 120
ICE_SERVER_KEYS = frozenset({'urls', 'username', 'credential'})


def _validate_ice_servers(raw):
    """Validate ``ice_servers`` against ``TelephonyIceServerSchema`` or answer 502."""
    if not isinstance(raw, list):
        raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
    cleaned = []
    for entry in raw:
        if not isinstance(entry, dict) or not set(entry).issubset(ICE_SERVER_KEYS):
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        urls = entry.get('urls')
        valid_urls = (
            (isinstance(urls, str) and bool(urls))
            or (isinstance(urls, list) and bool(urls) and all(isinstance(item, str) and bool(item) for item in urls))
        )
        if not valid_urls:
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        server = {'urls': urls}
        for key in ('username', 'credential'):
            if key in entry:
                value = entry[key]
                if not isinstance(value, str) or not value:
                    raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
                server[key] = value
        cleaned.append(server)
    return cleaned


def _user_extension():
    return request.env['liwan.telephony.extension'].search(
        [
            ('user_id', '=', request.env.user.id),
            ('company_id', '=', request.env.company.id),
            ('active', '=', True),
        ],
        limit=1,
    )


class TelephonySessionController(http.Controller):

    @http.route('/api/v1/telephony/session', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.use')
    def create_session(self, **_):
        extension = _user_extension()
        if not extension:
            raise ApiError(404, 'not_found', 'This user has no extension in the current company.')
        answer = request.env['liwan.telephony.agent']._liwan_request('POST', '/registration', {
            'extension': extension.number,
            'database': request.env.cr.dbname,
        })
        ws_url = answer.get('ws_url')
        auth_username = answer.get('auth_username')
        password = answer.get('password')
        expires_in = answer.get('expires_in_seconds')
        valid = (
            isinstance(ws_url, str) and bool(WS_URL_PATTERN.fullmatch(ws_url))
            and isinstance(auth_username, str) and 1 <= len(auth_username) <= AUTH_USERNAME_MAX_LENGTH
            and isinstance(password, str) and bool(password)
            and type(expires_in) is int and SESSION_MIN_SECONDS <= expires_in <= SESSION_MAX_SECONDS
        )
        if not valid:
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        ice_servers = _validate_ice_servers(answer.get('ice_servers'))
        return {
            'wsUrl': ws_url,
            'extension': extension.number,
            'authUsername': auth_username,
            'password': password,
            'iceServers': ice_servers,
            'expiresInSeconds': expires_in,
        }

    @http.route('/api/v1/telephony/session', type='json2', auth='user', methods=['DELETE'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.use')
    def delete_session(self, **_):
        extension = _user_extension()
        if not extension:
            return {'revoked': False}
        request.env['liwan.telephony.agent']._liwan_request('DELETE', f'/registration/{extension.number}')
        return {'revoked': True}
