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
MAX_MONTH = 2000
STATES = {'draft', 'confirmed', 'done', 'cancelled'}


def _parse_day(value, field):
    if not isinstance(value, str) or len(value) != 10:
        raise ApiError(422, 'invalid', '%s must be YYYY-MM-DD' % field, field=field)
    return value


def _parse_dt(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', '%s must be a datetime' % field, field=field)
    return value.strip().replace('T', ' ').replace('Z', '')


class MeetingController(http.Controller):

    @http.route('/api/v1/meetings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_meetings(self, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        args = request.httprequest.args
        date_from = (args.get('date_from') or '').strip()
        date_to = (args.get('date_to') or '').strip()
        cap = MAX_MONTH if date_from and date_to else MAX_MEETINGS
        default_limit = cap
        limit = min(parse_nonneg_int(args.get('limit', default_limit), 'limit') or default_limit, cap)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        domain = []
        q = (args.get('q') or '').strip()
        if q:
            domain += ['|', ('name', 'ilike', q), ('reference', 'ilike', q)]
        if args.get('state'):
            if args.get('state') not in STATES:
                raise ApiError(422, 'invalid', 'invalid state', field='state')
            domain.append(('state', '=', args.get('state')))
        if date_from:
            domain.append(('meeting_date', '>=', _parse_day(date_from, 'date_from')))
        if date_to:
            domain.append(('meeting_date', '<=', _parse_day(date_to, 'date_to')))
        if args.get('organizer_id'):
            domain.append(('organizer_id', '=', parse_positive_int(args.get('organizer_id'), 'organizer_id')))
        if args.get('project_id'):
            domain.append(('project_id', '=', parse_positive_int(args.get('project_id'), 'project_id')))
        if args.get('series_id'):
            domain.append(('series_id', '=', parse_positive_int(args.get('series_id'), 'series_id')))
        if args.get('mine') in {'1', 'true'}:
            uid = request.env.uid
            domain += ['|', '|', ('organizer_id', '=', uid), ('secretary_id', '=', uid), ('attendee_ids', 'in', [uid])]
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
    def create_meeting(self, name=None, meeting_date=None, location=None, start_datetime=None, end_datetime=None, meeting_url=None, attendee_ids=None, secretary_id=None, agenda=None, series_id=None, project_id=None, **_):
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
            vals['start_datetime'] = _parse_dt(start_datetime, 'start_datetime')
        if isinstance(end_datetime, str) and end_datetime.strip():
            vals['end_datetime'] = _parse_dt(end_datetime, 'end_datetime')
        if isinstance(meeting_url, str) and meeting_url.strip():
            vals['meeting_url'] = meeting_url.strip()
        if secretary_id:
            vals['secretary_id'] = parse_positive_int(secretary_id, 'secretary_id')
        if isinstance(attendee_ids, list):
            vals['attendee_ids'] = [(6, 0, [parse_positive_int(item, 'attendee_ids') for item in attendee_ids])]
        if isinstance(agenda, str):
            vals['agenda'] = agenda
        if series_id:
            vals['series_id'] = parse_positive_int(series_id, 'series_id')
        if project_id:
            vals['project_id'] = parse_positive_int(project_id, 'project_id')
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
        if payload.get('series_id'):
            vals['series_id'] = parse_positive_int(payload['series_id'], 'series_id')
        if 'project_id' in payload:
            vals['project_id'] = parse_positive_int(payload['project_id'], 'project_id') if payload['project_id'] else False
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        scope = payload.get('scope') or 'this'
        if scope not in {'this', 'this_and_following'}:
            raise ApiError(422, 'invalid', 'invalid scope', field='scope')
        if scope == 'this_and_following':
            meeting.action_apply_schedule_scope(vals, scope)
        else:
            meeting.write(vals)
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def cancel_meeting(self, meeting_id, scope='this', **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if scope not in {'this', 'this_and_following'}:
            raise ApiError(422, 'invalid', 'invalid scope', field='scope')
        meeting.action_cancel_scope(scope)
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

    def _resolution(self, meeting_id, resolution_id):
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        return meeting, resolution

    @http.route('/api/v1/meetings/<int:meeting_id>/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def confirm_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        meeting.action_confirm()
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/complete', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def complete_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        meeting.action_done()
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/reopen', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def reopen_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        meeting.action_reset_draft()
        return dump_meeting(meeting, detail=True)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    def patch_resolution(self, meeting_id, resolution_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        _meeting, resolution = self._resolution(meeting_id, resolution_id)
        vals = {}
        if 'name' in payload:
            if not isinstance(payload['name'], str) or not payload['name'].strip():
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
            vals['name'] = payload['name'].strip()
        if 'deadline' in payload and isinstance(payload['deadline'], str) and payload['deadline'].strip():
            vals['deadline'] = payload['deadline'].strip()
        if payload.get('responsible_id'):
            vals['responsible_id'] = parse_positive_int(payload['responsible_id'], 'responsible_id')
        if isinstance(payload.get('priority'), str) and payload['priority'] in {'0', '1', '2', '3'}:
            vals['priority'] = payload['priority']
        if 'result' in payload:
            if payload['result'] is not None and not isinstance(payload['result'], str):
                raise ApiError(422, 'invalid', 'result must be a string', field='result')
            vals['result'] = payload['result'] or ''
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        resolution.write(vals)
        return dump_resolution(resolution)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/<string:action>',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    def resolution_action(self, meeting_id, resolution_id, action, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        _meeting, resolution = self._resolution(meeting_id, resolution_id)
        methods = {'start': 'action_start', 'complete': 'action_done', 'cancel': 'action_cancel', 'reopen': 'action_reopen'}
        if action not in methods:
            raise ApiError(404, 'not_found', 'unknown action')
        getattr(resolution, methods[action])()
        return dump_resolution(resolution)

    @http.route('/api/v1/meetings/<int:meeting_id>/minutes.pdf', type='http', auth='user', methods=['GET'], csrf=False)
    def minutes_pdf(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        pdf, _type = request.env['ir.actions.report']._render_qweb_pdf(
            'cyan_meeting_minutes.action_report_meeting_minutes', meeting.ids,
        )
        filename = '%s.pdf' % (meeting.reference or 'minutes')
        return request.make_response(pdf, headers=[
            ('Content-Type', 'application/pdf'),
            ('Content-Disposition', 'attachment; filename="%s"' % filename),
        ])
