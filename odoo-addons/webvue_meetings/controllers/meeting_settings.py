# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_meetings.models.meeting_settings import (
    DEFAULTS,
    SCHEDULE_POLICIES,
)

STALE = 'Meetings settings changed; reload before saving'


class MeetingSettingsController(http.Controller):

    @http.route('/api/v1/meetings/settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    @requires_capability('meetings.settings.manage')
    def get_settings(self, **_):
        return _dump_current()

    @http.route('/api/v1/meetings/settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    @requires_capability('meetings.settings.manage')
    def patch_settings(self, **payload):
        revision, vals = _parse_patch(payload)
        model = request.env['webvue.meeting.settings']
        row = model._webvue_current()
        if revision != (row.revision if row else 0):
            raise ApiError(409, 'conflict', STALE)
        try:
            with request.env.cr.savepoint():
                if row:
                    row.write({**vals, 'revision': revision + 1})
                else:
                    model.create({**vals, 'company_id': request.env.company.id})
        except UniqueViolation as error:
            raise ApiError(409, 'conflict', STALE) from error
        return _dump_current()


def _parse_patch(payload):
    unknown = sorted(set(payload) - {'revision', 'values'})
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    values = payload.get('values')
    if not isinstance(values, dict) or not values:
        raise ApiError(422, 'invalid', 'values must be a non-empty object', field='values')
    unknown = sorted(set(values) - set(DEFAULTS))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    policy = values.get('schedule_policy')
    if policy not in SCHEDULE_POLICIES:
        raise ApiError(422, 'invalid', 'schedule_policy must be one of: %s' % ', '.join(SCHEDULE_POLICIES), field='schedule_policy')
    return revision, {'schedule_policy': policy}


def _dump_current():
    model = request.env['webvue.meeting.settings']
    row = model._webvue_current()
    return {
        'values': model._webvue_effective(),
        'defaults': dict(DEFAULTS),
        'options': {'schedule_policy': list(SCHEDULE_POLICIES)},
        'revision': row.revision if row else 0,
    }
