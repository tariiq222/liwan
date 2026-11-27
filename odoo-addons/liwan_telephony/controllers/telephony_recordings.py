# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The signed recording link (design 4.4).

Listening to a recording is its own capability, and every listen is written to the audit. The route does not stream the
audio: it asks the company's agent for a one-minute signed URL and returns it, so the file never crosses Odoo and a
link that leaks stops working almost at once.
"""
import json
import time
import urllib.error
import urllib.request

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_telephony.controllers.telephony_session import _agent_base

AGENT_TIMEOUT_SECONDS = 5


class TelephonyRecordingController(http.Controller):

    @http.route(
        '/api/v1/telephony/calls/<int:call_id>/recording',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=False,
    )
    @api_handler
    @requires_feature('telephony.enabled', operation='read')
    @requires_feature('telephony.recording', operation='read')
    def recording_link(self, call_id, **_):
        service = request.env['liwan.access.service']
        if not service._liwan_has_capability(request.env.user, 'telephony.recordings.listen'):
            raise ApiError(403, 'forbidden', 'telephony.recordings.listen capability is required')
        call = request.env['liwan.telephony.call'].browse(call_id).exists()
        if not call:
            raise ApiError(404, 'not_found', 'The call does not exist.')
        if call.recording_state != 'available':
            raise ApiError(404, 'not_found', 'This call has no recording.')
        base, key = _agent_base()
        if not base or not key:
            raise ApiError(503, 'unavailable', 'The telephony package is not configured for this company.')
        payload = json.dumps({
            'linkedid': call.linkedid,
            'database': request.env.cr.dbname,
            'expires_at': int(time.time()) + 60,
        }).encode()
        link_request = urllib.request.Request(
            f'{base.rstrip("/")}/recordings/link',
            data=payload,
            headers={'Content-Type': 'application/json', 'X-Liwan-Key': key},
            method='POST',
        )
        try:
            with urllib.request.urlopen(link_request, timeout=AGENT_TIMEOUT_SECONDS) as response:  # noqa: S310 - fixed base
                answer = json.loads(response.read() or b'{}')
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise ApiError(503, 'unavailable', f'The telephone system did not answer: {error}') from error
        url = answer.get('url')
        if not url:
            raise ApiError(404, 'not_found', 'The recording is not on the telephone system.')
        # The listen is recorded before the link is handed out, so the audit never misses a play it permitted.
        request.env['liwan.telephony.recording.access'].create({
            'call_id': call.id,
            'user_id': request.env.user.id,
        })
        return {'url': url, 'expiresInSeconds': 60}
