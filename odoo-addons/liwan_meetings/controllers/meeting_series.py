# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timezone

from odoo import http
from odoo.http import request

from .meetings import _parse_url, _validate_internal_user, _validate_internal_users
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_visible_record,
    parse_nonneg_int,
    parse_positive_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_meetings.models.meeting_series import MAX_OCCURRENCES
from odoo.addons.liwan_meetings.serializers.meeting import (
    dump_meeting,
    dump_series,
    projected_resolution_counts,
)

MAX_SERIES = 200
RECURRENCE = {'none', 'weekly', 'biweekly', 'monthly'}


def _parse_series_datetime(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', '%s must be a datetime' % field, field=field)
    raw = value.strip().replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise ApiError(422, 'invalid', '%s must be a valid ISO datetime' % field, field=field) from None
    if parsed.tzinfo:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.strftime('%Y-%m-%d %H:%M:%S')


def _parse_series_date(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', '%s must be a date' % field, field=field)
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError:
        raise ApiError(422, 'invalid', '%s must be a valid ISO date' % field, field=field) from None


def _parse_until_count(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_OCCURRENCES:
        raise ApiError(
            422, 'invalid', 'Occurrence count must be between 1 and %s' % MAX_OCCURRENCES, field='until_count',
        )
    return value


def _parse_limit(value):
    limit = parse_positive_int(value, 'limit')
    if limit > MAX_SERIES:
        raise ApiError(422, 'invalid', 'limit must be between 1 and %s' % MAX_SERIES, field='limit')
    return limit


class MeetingSeriesController(http.Controller):

    @http.route('/api/v1/meeting-series', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def list_series(self, **_):
        require_capabilities('meetings.read')
        args = request.httprequest.args
        limit = _parse_limit(args.get('limit', 50))
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        q = (args.get('q') or '').strip()
        if q:
            domain += ['|', ('name', 'ilike', q), ('location', 'ilike', q)]
        if args.get('project_id'):
            domain += request.env['liwan.meeting.links']._liwan_project_domain(
                parse_positive_int(args.get('project_id'), 'project_id'),
            )
        # Ended series stay listed (flagged `active: false`) so they can still be found.
        Series = request.env['liwan.meeting.series'].with_context(active_test=False)
        records = Series.search(domain, order='name, id', limit=limit, offset=offset)
        counts = projected_resolution_counts(records.meeting_ids)
        return {
            'items': [dump_series(series, counts=counts) for series in records],
            'total': Series.search_count(domain),
        }

    @http.route('/api/v1/meeting-series/<int:series_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def get_series(self, series_id, **_):
        require_capabilities('meetings.read')
        return dump_series(get_visible_record('liwan.meeting.series', series_id), detail=True)

    @http.route('/api/v1/meeting-series/<int:series_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def patch_series(self, series_id, **payload):
        require_capabilities('meetings.read')
        series = get_visible_record('liwan.meeting.series', series_id)
        if not series._liwan_is_editor():
            raise ApiError(403, 'forbidden', 'Only the organizer, secretary or a meetings manager may edit this series.')

        allowed = {'name', 'location', 'meeting_url', 'secretary_id', 'attendee_ids'}
        unknown = set(payload) - allowed
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'invalid', 'The series setting %s cannot be edited here.' % field, field=field)
        if not payload:
            raise ApiError(422, 'invalid', 'no fields to update')

        vals = {}
        if 'name' in payload:
            if not isinstance(payload['name'], str) or not payload['name'].strip():
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
            vals['name'] = payload['name'].strip()
        if 'location' in payload:
            if payload['location'] is not None and not isinstance(payload['location'], str):
                raise ApiError(422, 'invalid', 'location must be a string', field='location')
            vals['location'] = payload['location'].strip() if payload['location'] else False
        if 'meeting_url' in payload:
            vals['meeting_url'] = _parse_url(payload['meeting_url'])
        if 'secretary_id' in payload:
            secretary_id = payload['secretary_id']
            vals['secretary_id'] = False if secretary_id is None else _validate_internal_user(secretary_id, 'secretary_id')
        if 'attendee_ids' in payload:
            vals['attendee_ids'] = [(6, 0, _validate_internal_users(payload['attendee_ids'], 'attendee_ids'))]

        series.write(vals)
        return dump_series(series, detail=True)

    @http.route('/api/v1/meeting-series', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def create_series(self, name=None, project_id=None, secretary_id=None, attendee_ids=None, recurrence='none', until_date=None, until_count=None, location=None, meeting_url=None, start_datetime=None, end_datetime=None, **_):
        require_capabilities('meetings.create')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        if recurrence not in RECURRENCE:
            raise ApiError(422, 'invalid', 'invalid recurrence', field='recurrence')
        vals = {
            'name': name.strip(),
            'recurrence': recurrence,
            'organizer_id': request.env.uid,
        }
        if project_id:
            vals.update(request.env['liwan.meeting.links']._liwan_project_vals(
                parse_positive_int(project_id, 'project_id'),
            ))
        if secretary_id:
            vals['secretary_id'] = _validate_internal_user(secretary_id, 'secretary_id')
        if attendee_ids is not None:
            vals['attendee_ids'] = [(6, 0, _validate_internal_users(attendee_ids, 'attendee_ids'))]
        if isinstance(until_date, str) and until_date.strip():
            vals['until_date'] = _parse_series_date(until_date, 'until_date')
        if until_count is not None:
            vals['until_count'] = _parse_until_count(until_count)
        if isinstance(location, str) and location.strip():
            vals['location'] = location.strip()
        if meeting_url is not None:
            vals['meeting_url'] = _parse_url(meeting_url)
        series = request.env['liwan.meeting.series'].create(vals)
        if recurrence != 'none':
            if not start_datetime or not end_datetime:
                raise ApiError(422, 'invalid', 'start and end are required for recurrence')
            start = _parse_series_datetime(start_datetime, 'start_datetime')
            end = _parse_series_datetime(end_datetime, 'end_datetime')
            if datetime.strptime(end, '%Y-%m-%d %H:%M:%S') <= datetime.strptime(start, '%Y-%m-%d %H:%M:%S'):
                raise ApiError(422, 'invalid', 'end_datetime must be after start_datetime', field='end_datetime')
            series.action_generate_occurrences(start, end)
        return request.make_json_response(dump_series(series, detail=True), status=201)

    @http.route('/api/v1/meeting-series/<int:series_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def cancel_series(self, series_id, **_):
        require_capabilities('meetings.read')
        series = get_visible_record('liwan.meeting.series', series_id)
        series.action_cancel_series()
        return dump_series(series, detail=True)

    @http.route('/api/v1/meeting-series/<int:series_id>/occurrences', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def add_occurrence(self, series_id, start_datetime=None, end_datetime=None, name=None, **_):
        require_capabilities('meetings.create')
        series = get_visible_record('liwan.meeting.series', series_id)
        start = _parse_series_datetime(start_datetime, 'start_datetime') if start_datetime is not None else None
        stop = _parse_series_datetime(end_datetime, 'end_datetime') if end_datetime is not None else None
        if (start is None) != (stop is None):
            field = 'end_datetime' if stop is None else 'start_datetime'
            raise ApiError(422, 'invalid', 'start_datetime and end_datetime must be given together', field=field)
        if start and datetime.strptime(stop, '%Y-%m-%d %H:%M:%S') <= datetime.strptime(start, '%Y-%m-%d %H:%M:%S'):
            raise ApiError(422, 'invalid', 'end_datetime must be after start_datetime', field='end_datetime')
        meeting = series.action_add_occurrence(start, stop, name.strip() if isinstance(name, str) and name.strip() else None)
        return request.make_json_response(dump_meeting(meeting, detail=True), status=201)
