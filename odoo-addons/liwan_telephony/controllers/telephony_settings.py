# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The recording settings of the database (design 4.4, 8).

Any phone user reads the policy, whichever company they work in; only a ``telephony.manage`` holder who works in the
root company and holds the capability there writes it, because the one pbx-db recording config row and the dialplan read
one policy for the whole database. A write names the field it refuses: an unknown key, a wrong type and an out-of-range
value each answer 422 ``invalid``. A save tells the agent the new policy once the write is committed, so the pbx may lag
Odoo by one save and never lead it; a failed push is logged warning naming the database and does not undo the write.
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
    MANAGE_CAPABILITY,
    RECORDING_POLICIES,
    RETENTION_DAYS_RANGE,
)
from odoo.addons.liwan_telephony.serializers.telephony_settings import (
    dump_telephony_settings,
)

SETTINGS = '/api/v1/telephony/settings'
SETTINGS_KEYS = frozenset({'recordingPolicy', 'recordingAnnouncement', 'recordingRetentionDays'})
MISSING_SETTINGS = 'The recording settings are not installed.'


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


def current_settings():
    """The database's one settings row, or 404 ``not_found`` when the installed record is missing."""
    settings = request.env['liwan.telephony.settings']._liwan_current()
    if not settings:
        raise ApiError(404, 'not_found', MISSING_SETTINGS)
    return settings


def require_root_manager():
    """403 ``forbidden`` unless the session works in the root company and holds ``telephony.manage`` there.

    The policy binds every company of the database, so a grant held in one branch is not enough: the route's
    ``requires_capability`` gate accepts a capability held in any company of the current company's branch scope,
    which is why the root grant is checked here, in the root company itself.
    """
    root = request.env['liwan.entitlement.service']._liwan_profile().root_company_id
    service = request.env['liwan.access.service']
    if request.env.company != root or not service._liwan_has_capability(
        request.env.user, MANAGE_CAPABILITY, company=root,
    ):
        raise ApiError(403, 'forbidden', 'the recording policy belongs to the managers of the root company')


class TelephonySettingsController(http.Controller):

    @http.route(SETTINGS, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='read')
    @requires_capability('telephony.use')
    def get_settings(self, **_):
        """The database's recording policy: the values in effect for every company."""
        return dump_telephony_settings(current_settings())

    @http.route(SETTINGS, type='json2', auth='user', methods=['PATCH'])
    @api_handler
    @requires_feature(EVENTS_FEATURE, operation='write')
    @requires_capability('telephony.manage')
    def patch_settings(self, **payload):
        require_root_manager()
        values = parse_settings(payload)
        settings = current_settings()
        if values:
            settings.write(values)
        # A save is pushed even when it changed nothing: the agent may have missed an earlier push.
        settings._liwan_queue_agent_push()
        return dump_telephony_settings(settings)
