# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one place that calls the company's ``pbx-agent`` (design 12.3, 12.6).

The agent answers on the package's private network and takes the reverse-direction key in ``X-Liwan-Key``. Its address
and that key are system parameters, which only an Odoo administrator reads: this service holds the one elevated read,
so no route reads them itself. A call that fails answers a fixed message, because the exception text names hosts and
paths and never reaches a browser. A test replaces ``_liwan_post`` and needs no network.
"""
import http.client
import json
import logging
import urllib.request

from odoo import api, models

from odoo.addons.liwan_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)

AGENT_TIMEOUT_SECONDS = 5
AGENT_URL_PARAMETER = 'liwan.telephony.agent_url'
AGENT_KEY_PARAMETER = 'liwan.telephony.reverse_key'
AGENT_NOT_CONFIGURED = 'The telephony package is not configured for this company.'
AGENT_UNREACHABLE = 'The telephone system did not answer.'
AGENT_BAD_ANSWER = 'The telephone system returned an unexpected answer.'


class LiwanTelephonyAgent(models.AbstractModel):
    _name = 'liwan.telephony.agent'
    _description = 'LiwanOS telephony agent client'

    @api.model
    def _liwan_ask(self, path, body):
        """Post ``body`` to the agent's ``path`` and return the JSON object it answered.

        503 ``unavailable`` when the deployment names no agent or none answered, and 502 ``bad_gateway`` when it
        answered anything but a JSON object. The caller decides what its own answer must hold.
        """
        # System parameters are readable by base.group_system only: the one elevated read of the agent settings.
        params = self.env['ir.config_parameter'].sudo()
        base, key = params.get_param(AGENT_URL_PARAMETER), params.get_param(AGENT_KEY_PARAMETER)
        if not base or not key:
            raise ApiError(503, 'unavailable', AGENT_NOT_CONFIGURED)
        url = f"{base.rstrip('/')}{path}"
        try:
            answer = self._liwan_post(url, json.dumps(body).encode(), key)
        except (OSError, http.client.HTTPException, ValueError) as error:
            _logger.warning('liwan_telephony: the agent did not answer %s: %s', path, type(error).__name__)
            raise ApiError(503, 'unavailable', AGENT_UNREACHABLE) from error
        if not isinstance(answer, dict):
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        return answer

    def _liwan_post(self, url, payload, key):
        """The one network call of the addon. A test replaces this method so no test needs a network."""
        agent_request = urllib.request.Request(
            url, data=payload, headers={'Content-Type': 'application/json', 'X-Liwan-Key': key}, method='POST',
        )
        with urllib.request.urlopen(agent_request, timeout=AGENT_TIMEOUT_SECONDS) as response:
            return json.loads(response.read() or b'{}')
