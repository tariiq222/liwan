# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The browser session of one extension (design 4.1).

The route proves the feature, the capability and the company, then asks the company's agent for a registration
through ``liwan.telephony.agent``. The agent generates a new password for the extension and writes it to the Asterisk
realtime database, and the value reaches the browser once. Odoo stores nothing: the extension model has no password
field, and the reply is the only place the secret exists on this side.
"""
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

# How long the agent keeps a registration open when its answer names no lifetime.
DEFAULT_SESSION_SECONDS = 60


class TelephonySessionController(http.Controller):

    @http.route('/api/v1/telephony/session', type='json2', auth='user', methods=['POST'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.use')
    def create_session(self, **_):
        extension = request.env['liwan.telephony.extension'].search(
            [('user_id', '=', request.env.user.id), ('active', '=', True)], limit=1,
        )
        if not extension:
            raise ApiError(404, 'not_found', 'This user has no extension in the current company.')
        answer = request.env['liwan.telephony.agent']._liwan_ask('/registration', {
            'extension': extension.number,
            'database': request.env.cr.dbname,
        })
        granted = {
            'wsUrl': answer.get('ws_url'),
            'extension': extension.number,
            'password': answer.get('password'),
            'iceServers': answer.get('ice_servers') or [],
            'expiresInSeconds': answer.get('expires_in_seconds') or DEFAULT_SESSION_SECONDS,
        }
        if not all(isinstance(granted[name], str) and granted[name] for name in ('wsUrl', 'password')):
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        return granted
