# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_platform.models.maintenance_messages import (
    maintenance_time_message,
)
from odoo.addons.liwan_platform.models.maintenance_time import (
    local_to_utc,
    timezone_info,
)


def _integer(value, name, minimum, maximum=None):
    if type(value) is not int or value < minimum or (maximum is not None and value > maximum):
        raise ApiError(422, 'invalid', request.env._('Invalid integer value.'), field=name)
    return value


def _keys(payload, expected):
    if set(payload) != set(expected):
        raise ApiError(422, 'invalid', request.env._('Maintenance fields are missing or unknown.'))


def parse_preference(payload):
    _keys(payload, {'timezone', 'weekday', 'startMinute', 'durationMinutes', 'revision'})
    try:
        timezone_info(payload['timezone'])
    except ValueError as exc:
        raise ApiError(422, 'invalid', maintenance_time_message(request.env, exc), field='timezone') from exc
    return {
        'timezone': payload['timezone'],
        'weekday': _integer(payload['weekday'], 'weekday', 0, 6),
        'start_minute': _integer(payload['startMinute'], 'startMinute', 0, 1439),
        'duration_minutes': _integer(payload['durationMinutes'], 'durationMinutes', 1, 1440),
    }, _integer(payload['revision'], 'revision', 0)


def _parse_time(payload):
    try:
        scheduled = local_to_utc(payload['localDateTime'], payload['timezone'])
    except ValueError as exc:
        raise ApiError(422, 'invalid', maintenance_time_message(request.env, exc), field='localDateTime') from exc
    return {'scheduled_at': scheduled, 'timezone': payload['timezone'], 'duration_minutes': _integer(payload['durationMinutes'], 'durationMinutes', 1, 1440)}


def parse_booking(payload):
    if payload.get('usePreference') is True:
        _keys(payload, {'releaseId', 'usePreference', 'preferenceRevision'})
        return {'release_id': _integer(payload['releaseId'], 'releaseId', 1)}, _integer(payload['preferenceRevision'], 'preferenceRevision', 0)
    _keys(payload, {'releaseId', 'localDateTime', 'timezone', 'durationMinutes'})
    return {**_parse_time(payload), 'release_id': _integer(payload['releaseId'], 'releaseId', 1)}, None


def parse_booking_patch(payload):
    revision = _integer(payload.get('revision'), 'revision', 0)
    if payload.get('status') == 'cancelled':
        _keys(payload, {'status', 'revision'})
        return {'status': 'cancelled'}, revision
    _keys(payload, {'revision', 'localDateTime', 'timezone', 'durationMinutes'})
    return _parse_time(payload), revision


def dump_preference(record):
    if not record:
        return None
    return {'id': record.id, 'timezone': record.timezone, 'weekday': record.weekday, 'startMinute': record.start_minute, 'durationMinutes': record.duration_minutes, 'revision': record.revision}


def _utc(value):
    return value.isoformat(timespec='seconds') + 'Z'


def dump_release(record):
    return {'id': record.id, 'releaseId': record.release_id, 'deadlineAt': _utc(record.deadline_at), 'estimatedSeconds': record.estimated_seconds, 'scope': record.scope, 'status': record.status, 'urgency': record.urgency, 'policy': record.policy}


def dump_booking(record):
    return {'id': record.id, 'releaseId': record.release_id.id, 'scheduledAt': _utc(record.scheduled_at), 'timezone': record.timezone, 'durationMinutes': record.duration_minutes, 'status': record.status, 'revision': record.revision}
