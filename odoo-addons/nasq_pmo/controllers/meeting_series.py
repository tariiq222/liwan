# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timezone

from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
)
from odoo.addons.nasq_pmo.serializers.meeting import dump_meeting, dump_series

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


class MeetingSeriesController(http.Controller):

    @http.route('/api/v1/meeting-series', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_series(self, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit') or 50, MAX_SERIES)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        q = (args.get('q') or '').strip()
        if q:
            domain.append(('name', 'ilike', q))
        if args.get('project_id'):
            domain.append(('project_id', '=', parse_positive_int(args.get('project_id'), 'project_id')))
        Series = request.env['nasq.meeting.series']
        records = Series.search(domain, order='name, id', limit=limit, offset=offset)
        return {
            'items': [dump_series(series) for series in records],
            'total': Series.search_count(domain),
        }

    @http.route('/api/v1/meeting-series/<int:series_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_series(self, series_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        return dump_series(get_record('nasq.meeting.series', series_id), detail=True)

    @http.route('/api/v1/meeting-series', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_series(self, name=None, project_id=None, secretary_id=None, attendee_ids=None, recurrence='none', until_date=None, until_count=None, location=None, meeting_url=None, start_datetime=None, end_datetime=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.create')
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
            vals['project_id'] = parse_positive_int(project_id, 'project_id')
        if secretary_id:
            vals['secretary_id'] = parse_positive_int(secretary_id, 'secretary_id')
        if isinstance(attendee_ids, list):
            vals['attendee_ids'] = [(6, 0, [parse_positive_int(item, 'attendee_ids') for item in attendee_ids])]
        if isinstance(until_date, str) and until_date.strip():
            vals['until_date'] = _parse_series_date(until_date, 'until_date')
        if until_count:
            vals['until_count'] = parse_positive_int(until_count, 'until_count')
        if isinstance(location, str) and location.strip():
            vals['location'] = location.strip()
        if isinstance(meeting_url, str) and meeting_url.strip():
            vals['meeting_url'] = meeting_url.strip()
        series = request.env['nasq.meeting.series'].create(vals)
        if recurrence != 'none':
            if not start_datetime or not end_datetime:
                raise ApiError(422, 'invalid', 'start and end are required for recurrence')
            start = _parse_series_datetime(start_datetime, 'start_datetime')
            end = _parse_series_datetime(end_datetime, 'end_datetime')
            if datetime.strptime(end, '%Y-%m-%d %H:%M:%S') <= datetime.strptime(start, '%Y-%m-%d %H:%M:%S'):
                raise ApiError(422, 'invalid', 'end_datetime must be after start_datetime', field='end_datetime')
            series.action_generate_occurrences(start, end)
        return request.make_json_response(dump_series(series, detail=True), status=201)

    @http.route('/api/v1/meeting-series/<int:series_id>/occurrences', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def add_occurrence(self, series_id, start_datetime=None, end_datetime=None, name=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.create')
        series = get_record('nasq.meeting.series', series_id)
        start = _parse_series_datetime(start_datetime, 'start_datetime') if start_datetime is not None else None
        stop = _parse_series_datetime(end_datetime, 'end_datetime') if end_datetime is not None else None
        meeting = series.action_add_occurrence(start, stop, name.strip() if isinstance(name, str) and name.strip() else None)
        return request.make_json_response(dump_meeting(meeting, detail=True), status=201)
