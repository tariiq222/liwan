# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from psycopg2.errors import UniqueViolation

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_meetings.models.meeting_settings import (
    DEFAULTS,
    INTEGER_RANGES,
    REFERENCE_PREFIX_PATTERN,
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
        model = request.env['liwan.meeting.settings']
        row = model._liwan_current()
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
    if 'schedule_policy' in values and values['schedule_policy'] not in SCHEDULE_POLICIES:
        raise ApiError(422, 'invalid', 'schedule_policy must be one of: %s' % ', '.join(SCHEDULE_POLICIES), field='schedule_policy')
    for name in INTEGER_RANGES:
        if name in values and not _in_range(name, values[name]):
            low, high = INTEGER_RANGES[name]
            raise ApiError(422, 'invalid', 'must be a whole number from %d to %d' % (low, high), field=name)
    prefix = values.get('reference_prefix')
    if 'reference_prefix' in values and not (isinstance(prefix, str) and re.fullmatch(REFERENCE_PREFIX_PATTERN, prefix)):
        raise ApiError(422, 'invalid', 'reference_prefix must be 1 to 10 of A-Z and 0-9', field='reference_prefix')
    # An omitted setting keeps its saved value: the patch only carries what the form changed.
    return revision, {name: values[name] for name in DEFAULTS if name in values}


def _in_range(name, value):
    low, high = INTEGER_RANGES[name]
    return type(value) is int and low <= value <= high


def _dump_current():
    model = request.env['liwan.meeting.settings']
    row = model._liwan_current()
    return {
        'values': model._liwan_effective(),
        'defaults': dict(DEFAULTS),
        'options': {
            'schedule_policy': list(SCHEDULE_POLICIES),
            'reminder_hours': {'min': INTEGER_RANGES['reminder_hours'][0], 'max': INTEGER_RANGES['reminder_hours'][1]},
            'reference_prefix': {'pattern': REFERENCE_PREFIX_PATTERN, 'max_length': 10},
        },
        'revision': row.revision if row else 0,
    }
