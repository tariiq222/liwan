# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The recording settings of the current company (design 4.4, 8).

Any phone user reads the policy; only ``telephony.manage`` writes it. A company that never saved the page answers the
declared defaults, so the route never 404s. A write names the field it refuses: an unknown key, a wrong type and an
out-of-range value each answer 422 ``invalid``. Saving tells the agent the new policy once; a failed push is logged and
does not roll the write back.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
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


class TelephonySettingsController(http.Controller):

    @http.route(SETTINGS, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def get_settings(self, **_):
        """The current company's settings, or its declared defaults while the page was never saved."""
        settings = request.env['liwan.telephony.settings']._liwan_for(request.env.company)
        return dump_telephony_settings(settings)

    @http.route(SETTINGS, type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def patch_settings(self, **payload):
        values = parse_settings(payload)
        model = request.env['liwan.telephony.settings']
        row = model._liwan_current()
        if values:
            if row:
                row.write(values)
            else:
                row = model.create({'company_id': request.env.company.id, **values})
        # A saved row is pushed even when the save changed nothing: the agent may have missed an earlier push.
        if row:
            row._liwan_push_agent()
        return dump_telephony_settings(row or model._liwan_for(request.env.company))
