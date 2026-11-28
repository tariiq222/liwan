# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The recording settings of the database (design 4.4, 8).

Any phone user reads the policy, whichever company they work in; only a ``telephony.manage`` holder whose company is
the root company writes it, because the one pbx-db recording config row and the dialplan read one policy for the whole
database. A write names the field it refuses: an unknown key, a wrong type and an out-of-range value each answer 422
``invalid``. Saving tells the agent the new policy once; a failed push is logged and does not roll the write back.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_telephony.controllers.telephony_lines import (
    _choice,
    _no_extra_keys,
    _range,
    _refuse,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE
from odoo.addons.liwan_telephony.models.telephony_settings import (
    RECORDING_POLICIES,
    RETENTION_DAYS_RANGE,
)
from odoo.addons.liwan_telephony.serializers.telephony_settings import (
    dump_telephony_settings,
)

SETTINGS = '/api/v1/telephony/settings'
SETTINGS_KEYS = frozenset({'recordingPolicy', 'recordingAnnouncement', 'recordingRetentionDays'})


def parse_settings(payload):
    """The model values of a settings write; an omitted key keeps its saved value."""
    _no_extra_keys(payload, SETTINGS_KEYS)
    values = {}
    if 'recordingPolicy' in payload:
        values['recording_policy'] = _choice(payload['recordingPolicy'], RECORDING_POLICIES, 'recordingPolicy')
    if 'recordingAnnouncement' in payload:
        if type(payload['recordingAnnouncement']) is not bool:
            _refuse('recordingAnnouncement', 'recordingAnnouncement must be a boolean')
        values['recording_announcement'] = payload['recordingAnnouncement']
    if 'recordingRetentionDays' in payload:
        values['recording_retention_days'] = _range(
            payload['recordingRetentionDays'], *RETENTION_DAYS_RANGE, field='recordingRetentionDays',
        )
    return values


def require_root_manager():
    """403 ``forbidden`` unless the session works in the root company.

    The policy binds every company of the database, so the ``telephony.manage`` of one branch company only reads it; the
    capability itself is the route's ``requires_capability`` gate, which reads the current company.
    """
    root = request.env['liwan.entitlement.service']._liwan_profile().root_company_id
    if request.env.company != root:
        raise ApiError(403, 'forbidden', 'the recording policy belongs to the managers of the root company')


class TelephonySettingsController(http.Controller):

    @http.route(SETTINGS, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def get_settings(self, **_):
        """The database's recording policy: the values in effect for every company."""
        return dump_telephony_settings(request.env['liwan.telephony.settings']._liwan_current())

    @http.route(SETTINGS, type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def patch_settings(self, **payload):
        require_root_manager()
        values = parse_settings(payload)
        settings = request.env['liwan.telephony.settings']._liwan_current()
        if values:
            settings.write(values)
        # A save is pushed even when it changed nothing: the agent may have missed an earlier push.
        settings._liwan_push_agent()
        return dump_telephony_settings(settings)
