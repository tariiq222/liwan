# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
)
from odoo.addons.nasq_pmo.serializers.meeting import dump_meeting, dump_resolution

MAX_MEETINGS = 200


class MeetingController(http.Controller):

    @http.route('/api/v1/meetings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_meetings(self, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', MAX_MEETINGS), 'limit') or MAX_MEETINGS, MAX_MEETINGS)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        q = (args.get('q') or '').strip()
        if q:
            domain.append('|')
            domain.append(('name', 'ilike', q))
            domain.append(('reference', 'ilike', q))
        Meeting = request.env['cyan.meeting.minute']
        records = Meeting.search(domain, order='meeting_date desc, id desc', limit=limit, offset=offset)
        return {
            'items': [dump_meeting(meeting) for meeting in records],
            'total': Meeting.search_count(domain),
        }

    @http.route('/api/v1/meetings/<int:meeting_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def get_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_meeting(self, name=None, meeting_date=None, location=None, start_datetime=None, end_datetime=None, meeting_url=None, attendee_ids=None, secretary_id=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.create')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        vals = {
            'name': name.strip(),
            'organizer_id': request.env.uid,
        }
        if isinstance(meeting_date, str) and meeting_date.strip():
            vals['meeting_date'] = meeting_date.strip()
        if isinstance(location, str) and location.strip():
            vals['location'] = location.strip()
        if isinstance(start_datetime, str) and start_datetime.strip():
            vals['start_datetime'] = start_datetime.strip().replace('T', ' ').replace('Z', '')
        if isinstance(end_datetime, str) and end_datetime.strip():
            vals['end_datetime'] = end_datetime.strip().replace('T', ' ').replace('Z', '')
        if isinstance(meeting_url, str) and meeting_url.strip():
            vals['meeting_url'] = meeting_url.strip()
        if secretary_id:
            vals['secretary_id'] = parse_positive_int(secretary_id, 'secretary_id')
        if isinstance(attendee_ids, list):
            vals['attendee_ids'] = [(6, 0, [parse_positive_int(item, 'attendee_ids') for item in attendee_ids])]
        meeting = request.env['cyan.meeting.minute'].create(vals)
        return request.make_json_response(dump_meeting(meeting, detail=True), status=201)

    @http.route('/api/v1/meetings/<int:meeting_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_meeting(self, meeting_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        payload.pop('meeting_id', None)
        vals = {}
        for field in ('name', 'location', 'agenda', 'minutes'):
            if field in payload:
                value = payload[field]
                if value is not None and not isinstance(value, str):
                    raise ApiError(422, 'invalid', '%s must be a string' % field, field=field)
                vals[field] = (value or '').strip() if field == 'name' else (value or '')
        if 'meeting_date' in payload and isinstance(payload['meeting_date'], str) and payload['meeting_date'].strip():
            vals['meeting_date'] = payload['meeting_date'].strip()
        if 'secretary_id' in payload:
            vals['secretary_id'] = parse_positive_int(payload['secretary_id'], 'secretary_id') if payload['secretary_id'] else False
        if 'attendee_ids' in payload:
            if not isinstance(payload['attendee_ids'], list):
                raise ApiError(422, 'invalid', 'attendee_ids must be a list', field='attendee_ids')
            vals['attendee_ids'] = [(6, 0, [parse_positive_int(item, 'attendee_ids') for item in payload['attendee_ids']])]
        for field in ('start_datetime', 'end_datetime'):
            if field in payload and isinstance(payload[field], str) and payload[field].strip():
                vals[field] = payload[field].strip().replace('T', ' ').replace('Z', '')
        if 'meeting_url' in payload:
            value = payload['meeting_url']
            if value is not None and not isinstance(value, str):
                raise ApiError(422, 'invalid', 'meeting_url must be a string', field='meeting_url')
            vals['meeting_url'] = (value or '').strip()
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        meeting.write(vals)
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/resolutions', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_resolution(self, meeting_id, name=None, responsible_id=None, deadline=None, priority=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        if not isinstance(deadline, str) or not deadline.strip():
            raise ApiError(422, 'invalid', 'deadline is required', field='deadline')
        vals = {
            'meeting_id': meeting.id,
            'name': name.strip(),
            'responsible_id': parse_positive_int(responsible_id, 'responsible_id'),
            'deadline': deadline.strip(),
        }
        if isinstance(priority, str) and priority in {'0', '1', '2', '3'}:
            vals['priority'] = priority
        resolution = request.env['cyan.meeting.resolution'].create(vals)
        if resolution.responsible_id:
            meeting._nasq_notify_partners(
                resolution.responsible_id.partner_id,
                'meeting_resolution',
                resolution.name,
                key=f'meeting-res:{resolution.id}',
            )
        return request.make_json_response(dump_resolution(resolution), status=201)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/convert',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    def convert_resolution(self, meeting_id, resolution_id, project_id=None, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        task = resolution.action_convert_to_task(parse_positive_int(project_id, 'project_id'))
        return {'id': task.id, 'name': task.name}
