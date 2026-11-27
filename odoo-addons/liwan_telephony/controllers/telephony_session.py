# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The browser session of one extension (design 4.1).

The agent answers on `POST /registration` on the company's private network, authenticated with the reverse-direction
key in `X-Liwan-Key`.

The route proves the feature, the capability and the company, then asks the company's agent for a registration. The
agent generates a new password for the extension, writes it to the Asterisk realtime database, and the value reaches
the browser once. Odoo stores nothing: the extension model has no password field, and the reply is the only place the
secret exists on this side.
"""
import json
import urllib.error
import urllib.request

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

AGENT_TIMEOUT_SECONDS = 5


def _agent_base():
    """Where the company's agent answers, and the key this side signs with (design 12.3, 12.6)."""
    params = request.env['ir.config_parameter'].sudo()
    return params.get_param('liwan.telephony.agent_url'), params.get_param('liwan.telephony.reverse_key')


def _ask_agent(path, body):
    base, key = _agent_base()
    if not base or not key:
        raise ApiError(503, 'unavailable', 'The telephony package is not configured for this company.')
    payload = json.dumps(body).encode()
    request_ = urllib.request.Request(
        f'{base.rstrip("/")}{path}',
        data=payload,
        headers={'Content-Type': 'application/json', 'X-Liwan-Key': key},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request_, timeout=AGENT_TIMEOUT_SECONDS) as response:  # noqa: S310 - fixed base
            return json.loads(response.read() or b'{}')
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise ApiError(503, 'unavailable', f'The telephone system did not answer: {error}') from error


class TelephonySessionController(http.Controller):

    @http.route('/api/v1/telephony/session', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature('telephony.enabled', operation='write')
    def create_session(self, **_):
        service = request.env['liwan.access.service']
        if not service._liwan_has_capability(request.env.user, 'telephony.use'):
            raise ApiError(403, 'forbidden', 'telephony.use capability is required')
        extension = request.env['liwan.telephony.extension'].search(
            [('user_id', '=', request.env.user.id), ('active', '=', True)], limit=1,
        )
        if not extension:
            raise ApiError(404, 'not_found', 'This user has no extension in the current company.')
        answer = _ask_agent('/registration', {
            'extension': extension.number,
            'database': request.env.cr.dbname,
        })
        granted = {
            'wsUrl': answer.get('ws_url'),
            'extension': extension.number,
            'password': answer.get('password'),
            'iceServers': answer.get('ice_servers') or [],
            'expiresInSeconds': answer.get('expires_in_seconds') or 60,
        }
        if not granted['wsUrl'] or not granted['password']:
            raise ApiError(502, 'bad_gateway', 'The telephone system returned no registration.')
        return granted
