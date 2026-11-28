# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one place that calls the company's ``pbx-agent`` (design 12.3, 12.6).

The agent answers on the package's private network and verifies every reverse-direction request with an HMAC-SHA256
signature over ``<timestamp>\\n<METHOD>\\n<path>\\n<body>`` using the key derived from ``liwan.telephony.events_key_root``
(or a direct 64-hex ``liwan.telephony.reverse_key``). Those settings are system parameters, which only an Odoo
administrator reads: this service holds the one elevated read, so no route reads them itself. A call that fails answers
a fixed message, because the exception text names hosts and paths and never reaches a browser. A test replaces
``_liwan_send`` and needs no network.
"""
import hashlib
import hmac
import http.client
import json
import logging
import re
import time
import urllib.error
import urllib.request

from odoo import api, models

from odoo.addons.liwan_api.controllers.common import ApiError

_logger = logging.getLogger(__name__)

AGENT_TIMEOUT_SECONDS = 5
AGENT_URL_PARAMETER = 'liwan.telephony.agent_url'
AGENT_KEY_ROOT_PARAMETER = 'liwan.telephony.events_key_root'
AGENT_KEY_PARAMETER = 'liwan.telephony.reverse_key'
REVERSE_LABEL = 'liwan-telephony-reverse/v1'
TIMESTAMP_HEADER = 'X-Liwan-Telephony-Timestamp'
SIGNATURE_HEADER = 'X-Liwan-Telephony-Signature'
DATABASE_HEADER = 'X-Liwan-Telephony-Database'
HEX_KEY_PATTERN = re.compile(r'^[0-9a-fA-F]{64}$')
AGENT_NOT_CONFIGURED = 'The telephony package is not configured for this company.'
AGENT_UNREACHABLE = 'The telephone system did not answer.'
AGENT_BAD_ANSWER = 'The telephone system returned an unexpected answer.'
AGENT_NOT_FOUND = 'The requested telephony resource was not found.'


def _valid_hex_key(value):
    return isinstance(value, str) and bool(HEX_KEY_PATTERN.fullmatch(value))


def _liwan_sign_reverse(key_hex, timestamp, method, path, body_bytes):
    """Sign an Odoo → pbx-agent request with the reverse HMAC key (design 12.6)."""
    canonical = f'{timestamp}\n{method.upper()}\n{path}\n'.encode('ascii') + body_bytes
    return hmac.new(bytes.fromhex(key_hex), canonical, hashlib.sha256).hexdigest()


class LiwanTelephonyAgent(models.AbstractModel):
    _name = 'liwan.telephony.agent'
    _description = 'LiwanOS telephony agent client'

    @api.model
    def _liwan_config(self):
        """Return ``(base_url, key_hex)`` or ``(None, None)`` when the agent is not configured.

        System parameters are readable by ``base.group_system`` only: this is the one elevated read of the agent
        settings across the addon.
        """
        params = self.env['ir.config_parameter'].sudo()
        base = (params.get_param(AGENT_URL_PARAMETER) or '').strip().rstrip('/')
        if not base:
            return None, None
        root = (params.get_param(AGENT_KEY_ROOT_PARAMETER) or '').strip()
        if _valid_hex_key(root):
            key = hmac.new(
                bytes.fromhex(root),
                f'{REVERSE_LABEL}\n{self.env.cr.dbname}'.encode(),
                hashlib.sha256,
            ).hexdigest()
            return base, key
        reverse_key = (params.get_param(AGENT_KEY_PARAMETER) or '').strip()
        if _valid_hex_key(reverse_key):
            return base, reverse_key.lower()
        return None, None

    @api.model
    def _liwan_is_configured(self):
        """Whether the deployment has both an agent address and a valid reverse signing key."""
        base, key = self._liwan_config()
        return bool(base and key)

    @api.model
    def _liwan_request(self, method, path, body=None, *, not_found_message=None, config=None):
        """Send a signed request to the agent's ``path`` and return the JSON object it answered.

        503 ``unavailable`` when the deployment names no agent, the network fails or the agent answers 5xx, 404
        ``not_found`` when the agent answers 404, and 502 ``bad_gateway`` when the agent rejects the request with any
        other 4xx or returns anything other than a JSON object. ``config`` is the ``(base_url, key_hex)`` pair an
        after-commit caller read before its transaction committed; the default reads the saved configuration.
        """
        base, key = config or self._liwan_config()
        if not base or not key:
            raise ApiError(503, 'unavailable', AGENT_NOT_CONFIGURED)
        verb = method.upper()
        if body is not None:
            payload = json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        else:
            payload = b''
        timestamp = str(int(time.time()))
        headers = {
            TIMESTAMP_HEADER: timestamp,
            SIGNATURE_HEADER: _liwan_sign_reverse(key, timestamp, verb, path, payload),
            DATABASE_HEADER: self.env.cr.dbname,
        }
        if body is not None:
            headers['Content-Type'] = 'application/json'
        url = f'{base}{path}'
        try:
            answer = self._liwan_send(verb, url, payload, headers)
        except urllib.error.HTTPError as error:
            _logger.warning('liwan_telephony: the agent answered %s for %s %s', error.code, verb, path)
            if error.code == 404:
                raise ApiError(404, 'not_found', not_found_message or AGENT_NOT_FOUND) from error
            if error.code >= 500:
                raise ApiError(503, 'unavailable', AGENT_UNREACHABLE) from error
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER) from error
        except (OSError, http.client.HTTPException) as error:
            _logger.warning('liwan_telephony: the agent did not answer %s %s: %s', verb, path, type(error).__name__)
            raise ApiError(503, 'unavailable', AGENT_UNREACHABLE) from error
        except ValueError as error:
            _logger.warning('liwan_telephony: the agent returned unreadable JSON for %s %s', verb, path)
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER) from error
        if not isinstance(answer, dict):
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        return answer

    def _liwan_send(self, method, url, payload, headers):
        """The one network call of the addon. A test replaces this method so no test needs a network."""
        data = payload if payload else None
        agent_request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(agent_request, timeout=AGENT_TIMEOUT_SECONDS) as response:
            return json.loads(response.read() or b'{}')
