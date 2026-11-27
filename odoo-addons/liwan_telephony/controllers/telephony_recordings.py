# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The signed recording link (design 4.4).

Listening to a recording is its own capability, and every listen is written to the audit. The route does not stream the
audio: it asks the company's agent for a one-minute signed URL and returns it, so the file never crosses Odoo and a
link that leaks stops working almost at once.
"""
import re
import time

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_visible_record,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_telephony.models.agent_client import AGENT_BAD_ANSWER
from odoo.addons.liwan_telephony.models.feature_registry import (
    EVENTS_FEATURE,
    RECORDING_FEATURE,
)

RECORDING_URL_PATTERN = re.compile(r'^https?://.+')
RECORDING_LINK_MIN_SECONDS = 1
RECORDING_LINK_SECONDS = 60
NO_RECORDING = 'This call has no recording.'


def can_listen():
    """Whether the user may listen: the listening capability and the recording feature being readable, both."""
    env = request.env
    return (
        env['liwan.access.service']._liwan_has_capability(env.user, 'telephony.recordings.listen')
        and env['liwan.entitlement.service']._liwan_feature_read(RECORDING_FEATURE)
    )


class TelephonyRecordingController(http.Controller):

    @http.route(
        '/api/v1/telephony/calls/<int:call_id>/recording',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=False,
    )
    @api_handler
    @requires_feature(EVENTS_FEATURE, RECORDING_FEATURE, operation='read')
    @requires_capability('telephony.recordings.listen')
    def recording_link(self, call_id, **_):
        """A one-minute signed link to the recording of a call whose recording is ready.

        A call outside the caller's visibility, and one whose recording is not ready, answer the same not-found.
        """
        call = get_visible_record('liwan.telephony.call', call_id)
        if call.recording_state != 'available':
            raise ApiError(404, 'not_found', NO_RECORDING)
        answer = request.env['liwan.telephony.agent']._liwan_request(
            'POST',
            '/recordings/link',
            {
                'linkedid': call.linkedid,
                'database': request.env.cr.dbname,
                'expires_at': int(time.time()) + RECORDING_LINK_SECONDS,
            },
            not_found_message=NO_RECORDING,
        )
        url = answer.get('url')
        expires_in = answer.get('expiresInSeconds')
        valid = (
            isinstance(url, str) and bool(RECORDING_URL_PATTERN.fullmatch(url))
            and type(expires_in) is int and RECORDING_LINK_MIN_SECONDS <= expires_in <= RECORDING_LINK_SECONDS
        )
        if not valid:
            raise ApiError(502, 'bad_gateway', AGENT_BAD_ANSWER)
        # The listen is recorded before the link is handed out, so the audit never misses a play it permitted.
        request.env['liwan.telephony.recording.access'].create({
            'call_id': call.id,
            'user_id': request.env.user.id,
        })
        return {'url': url, 'expiresInSeconds': expires_in}
