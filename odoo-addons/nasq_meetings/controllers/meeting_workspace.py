# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.nasq_meetings.serializers.meeting import (
    dump_event,
    dump_resolution,
    dump_version,
)

MAX_WORKSPACE_PAGE = 100
RESOLUTION_STATES = {'open', 'in_progress', 'done', 'cancelled'}


def _page_args():
    args = request.httprequest.args
    limit = min(parse_nonneg_int(args.get('limit', 25), 'limit') or 25, MAX_WORKSPACE_PAGE)
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    return limit, offset


def _meeting_ids_for_series(series):
    return series.meeting_ids.filtered(lambda meeting: meeting.company_id == request.env.company).ids


class MeetingWorkspaceController(http.Controller):

    def _read(self):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')

    @http.route('/api/v1/meetings/<int:meeting_id>/events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_events(self, meeting_id, **_):
        self._read()
        meeting = get_record('cyan.meeting.minute', meeting_id)
        limit, offset = _page_args()
        Event = request.env['nasq.meeting.event']
        domain = [('meeting_id', '=', meeting.id), ('company_id', '=', request.env.company.id)]
        rows = Event.search(domain, order='occurred_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_event(event, meeting) for event in rows], 'total': Event.search_count(domain)}

    @http.route('/api/v1/meeting-series/<int:series_id>/events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def series_events(self, series_id, **_):
        self._read()
        series = get_record('nasq.meeting.series', series_id)
        meeting_ids = _meeting_ids_for_series(series)
        limit, offset = _page_args()
        Event = request.env['nasq.meeting.event']
        domain = [('meeting_id', 'in', meeting_ids), ('company_id', '=', request.env.company.id)]
        rows = Event.search(domain, order='occurred_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_event(event) for event in rows], 'total': Event.search_count(domain)}

    @http.route('/api/v1/meetings/<int:meeting_id>/versions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_versions(self, meeting_id, **_):
        self._read()
        meeting = get_record('cyan.meeting.minute', meeting_id)
        limit, offset = _page_args()
        Version = request.env['nasq.meeting.minutes.version']
        domain = [('meeting_id', '=', meeting.id), ('company_id', '=', request.env.company.id)]
        rows = Version.search(domain, order='captured_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_version(version) for version in rows], 'total': Version.search_count(domain)}

    @http.route('/api/v1/meetings/<int:meeting_id>/versions/<int:version_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_version(self, meeting_id, version_id, **_):
        self._read()
        meeting = get_record('cyan.meeting.minute', meeting_id)
        version = get_record('nasq.meeting.minutes.version', version_id)
        if version.company_id != request.env.company or version.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'meeting version not found')
        return dump_version(version)

    @http.route('/api/v1/meeting-series/<int:series_id>/resolutions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def series_resolutions(self, series_id, **_):
        self._read()
        series = get_record('nasq.meeting.series', series_id)
        limit, offset = _page_args()
        args = request.httprequest.args
        query = (args.get('q') or '').strip()
        state = (args.get('state') or '').strip()
        if state and state not in RESOLUTION_STATES | {'active', 'overdue'}:
            raise ApiError(422, 'invalid', 'invalid state', field='state')
        domain = [
            ('meeting_id.series_id', '=', series.id),
            ('meeting_id.company_id', '=', request.env.company.id),
        ]
        if query:
            domain += ['|', ('name', 'ilike', query), ('meeting_id.name', 'ilike', query)]
        if state in RESOLUTION_STATES:
            domain.append(('state', '=', state))
        elif state:
            domain.append(('state', 'in', ('open', 'in_progress')))
        if state == 'overdue':
            domain.append(('deadline', '<', fields.Date.context_today(request.env.user)))
        Resolution = request.env['cyan.meeting.resolution']
        # ``meeting_id`` orders by the meeting's own order (latest occurrence first).
        records = Resolution.search(domain, order='meeting_id, sequence, id', limit=limit, offset=offset)
        readable = request.env['nasq.meeting.links']._nasq_readable_links(records)
        items = []
        for resolution in records:
            row = dump_resolution(resolution, readable.get(resolution.id))
            row['meeting_id'] = resolution.meeting_id.id
            row['meeting_name'] = resolution.meeting_id.name
            items.append(row)
        return {'items': items, 'total': Resolution.search_count(domain)}
