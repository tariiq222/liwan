# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    require_capabilities,
    requires_feature,
)
from odoo.addons.webvue_meetings.serializers.meeting import (
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


def _resolution_filters(domain):
    args = request.httprequest.args
    query = (args.get('q') or '').strip()
    state = (args.get('state') or '').strip()
    if state and state not in RESOLUTION_STATES | {'active', 'overdue'}:
        raise ApiError(422, 'invalid', 'invalid state', field='state')
    if query:
        domain += ['|', ('name', 'ilike', query), ('meeting_id.name', 'ilike', query)]
    if args.get('mine') in ('1', 'true'):
        domain.append(('responsible_id', '=', request.env.uid))
    if state:
        states = (state,) if state in RESOLUTION_STATES else ('open', 'in_progress')
        domain += request.env['webvue.meeting.links']._webvue_resolution_execution_domain(states)
    if state == 'overdue':
        domain.append(('deadline', '<', fields.Date.context_today(request.env.user)))
    return domain


def _resolution_page(domain, *, order):
    limit, offset = _page_args()
    Resolution = request.env['webvue.meeting.resolution']
    records = Resolution.search(domain, order=order, limit=limit, offset=offset)
    links = request.env['webvue.meeting.links']
    readable = links._webvue_readable_links(records)
    linked_ids = links._webvue_linked_resolution_ids(records)
    manager = records._webvue_is_manager()
    items = []
    for resolution in records:
        row = dump_resolution(resolution, readable.get(resolution.id), linked_ids=linked_ids, manager=manager)
        row.update(meeting_id=resolution.meeting_id.id, meeting_name=resolution.meeting_id.name)
        items.append(row)
    return {'items': items, 'total': Resolution.search_count(domain)}


def _meeting_ids_for_series(series):
    return series.meeting_ids.filtered(lambda meeting: meeting.company_id in request.env.companies).ids


class MeetingWorkspaceController(http.Controller):

    def _read(self):
        require_capabilities('meetings.read')

    @http.route('/api/v1/meetings/<int:meeting_id>/events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_events(self, meeting_id, **_):
        self._read()
        meeting = get_record('webvue.meeting.minute', meeting_id)
        limit, offset = _page_args()
        Event = request.env['webvue.meeting.event']
        domain = [('meeting_id', '=', meeting.id), ('company_id', 'in', request.env.companies.ids)]
        rows = Event.search(domain, order='occurred_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_event(event, meeting) for event in rows], 'total': Event.search_count(domain)}

    @http.route('/api/v1/meeting-series/<int:series_id>/events', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def series_events(self, series_id, **_):
        self._read()
        series = get_record('webvue.meeting.series', series_id)
        meeting_ids = _meeting_ids_for_series(series)
        limit, offset = _page_args()
        Event = request.env['webvue.meeting.event']
        domain = [('meeting_id', 'in', meeting_ids), ('company_id', 'in', request.env.companies.ids)]
        rows = Event.search(domain, order='occurred_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_event(event) for event in rows], 'total': Event.search_count(domain)}

    @http.route('/api/v1/meetings/<int:meeting_id>/versions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_versions(self, meeting_id, **_):
        self._read()
        meeting = get_record('webvue.meeting.minute', meeting_id)
        limit, offset = _page_args()
        Version = request.env['webvue.meeting.minutes.version']
        domain = [('meeting_id', '=', meeting.id), ('company_id', 'in', request.env.companies.ids)]
        rows = Version.search(domain, order='captured_at desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_version(version) for version in rows], 'total': Version.search_count(domain)}

    @http.route('/api/v1/meetings/<int:meeting_id>/versions/<int:version_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_version(self, meeting_id, version_id, **_):
        self._read()
        meeting = get_record('webvue.meeting.minute', meeting_id)
        version = get_record('webvue.meeting.minutes.version', version_id)
        if version.company_id not in request.env.companies or version.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'meeting version not found')
        return dump_version(version)

    @http.route('/api/v1/meeting-series/<int:series_id>/resolutions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def series_resolutions(self, series_id, **_):
        self._read()
        series = get_record('webvue.meeting.series', series_id)
        domain = _resolution_filters([
            ('meeting_id.series_id', '=', series.id),
            ('meeting_id.company_id', 'in', request.env.companies.ids),
        ])
        return _resolution_page(domain, order='meeting_id, sequence, id')

    @http.route('/api/v1/meetings/resolutions', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def meeting_followup(self, **_):
        self._read()
        domain = _resolution_filters([('meeting_id.company_id', 'in', request.env.companies.ids)])
        # Odoo's date ascending order keeps unscheduled recommendations last.
        return _resolution_page(domain, order='deadline asc, id desc')
