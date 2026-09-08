# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

from odoo import fields, http
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
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, 'invalid', '%s must be YYYY-MM-DD' % field, field=field) from None
    if parsed.isoformat() != value:
        raise ApiError(422, 'invalid', '%s must be YYYY-MM-DD' % field, field=field)
    return parsed.isoformat()


def _parse_dt_parts(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', '%s must be a datetime' % field, field=field)
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        raise ApiError(422, 'invalid', '%s must be a valid ISO datetime' % field, field=field) from None
    input_day = parsed.date().isoformat() if parsed.tzinfo else None
    if parsed.tzinfo:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    storage = parsed.strftime('%Y-%m-%d %H:%M:%S')
    return storage, input_day or _user_calendar_day(storage)


def _parse_dt(value, field):
    return _parse_dt_parts(value, field)[0]


def _parse_url(value, field='meeting_url'):
    if value in (None, ''):
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', '%s must be a string' % field, field=field)
    value = value.strip()
    parsed = urlsplit(value)
    if not value or parsed.scheme not in {'http', 'https'} or not parsed.netloc or any(char.isspace() for char in value):
        raise ApiError(422, 'invalid', '%s must be a valid HTTP(S) URL' % field, field=field)
    return value


def _user_calendar_day(value):
    parsed = fields.Datetime.to_datetime(value)
    localized = fields.Datetime.context_timestamp(request.env.user, parsed)
    return localized.date().isoformat()


def _validate_schedule_range(start, end):
    parsed_start = fields.Datetime.to_datetime(start) if start else None
    parsed_end = fields.Datetime.to_datetime(end) if end else None
    if parsed_start and parsed_end and parsed_end <= parsed_start:
        raise ApiError(422, 'invalid', 'end_datetime must be after start_datetime', field='end_datetime')


def _parse_deadline(value):
    return _parse_day(value, 'deadline')


def _resolve_meeting_date(meeting_date, start, *, provided, start_day=None):
    if provided:
        if meeting_date is None:
            raise ApiError(422, 'invalid', 'meeting_date must be YYYY-MM-DD', field='meeting_date')
        resolved = _parse_day(meeting_date, 'meeting_date')
    elif start:
        resolved = start_day or _user_calendar_day(start)
    else:
        return None
    if start and resolved != (start_day or _user_calendar_day(start)):
        raise ApiError(422, 'invalid', 'meeting_date must match start_datetime in the user timezone', field='meeting_date')
    return resolved


def _parse_schedule_value(payload, field, *, allow_null):
    if field not in payload:
        return None, False
    value = payload[field]
    if value is None and allow_null:
        return False, True
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', '%s must be a datetime' % field, field=field)
    parsed, calendar_day = _parse_dt_parts(value, field)
    return (parsed, calendar_day), True


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
        body = request.get_json_data() if request.httprequest.content_length else {}
        if not isinstance(body, dict):
            body = {}
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        vals = {
            'name': name.strip(),
            'organizer_id': request.env.uid,
        }
        start_data, has_start = _parse_schedule_value(body, 'start_datetime', allow_null=True)
        end_data, has_end = _parse_schedule_value(body, 'end_datetime', allow_null=True)
        if has_start and start_data is not False:
            start, start_day = start_data
        else:
            start, start_day = (False if has_start else None), None
        end = end_data[0] if has_end and end_data is not False else (False if has_end else None)
        if has_start:
            vals['start_datetime'] = start
        if has_end:
            vals['end_datetime'] = end
        _validate_schedule_range(start, end)
        resolved_day = _resolve_meeting_date(
            meeting_date, start or None, provided='meeting_date' in body, start_day=start_day,
        )
        if resolved_day:
            vals['meeting_date'] = resolved_day
        if 'location' in body:
            if location is not None and not isinstance(location, str):
                raise ApiError(422, 'invalid', 'location must be a string', field='location')
            vals['location'] = location.strip() if location else False
        if 'meeting_url' in body:
            vals['meeting_url'] = _parse_url(meeting_url)
        if 'secretary_id' in body:
            vals['secretary_id'] = (
                False if secretary_id is None
                else parse_positive_int(secretary_id, 'secretary_id')
            )
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
        if 'meeting_date' in payload:
            vals['meeting_date'] = _parse_day(payload['meeting_date'], 'meeting_date')
        if 'secretary_id' in payload:
            vals['secretary_id'] = parse_positive_int(payload['secretary_id'], 'secretary_id') if payload['secretary_id'] else False
        if 'attendee_ids' in payload:
            if not isinstance(payload['attendee_ids'], list):
                raise ApiError(422, 'invalid', 'attendee_ids must be a list', field='attendee_ids')
            vals['attendee_ids'] = [(6, 0, [parse_positive_int(item, 'attendee_ids') for item in payload['attendee_ids']])]
        schedule_days = {}
        for field in ('start_datetime', 'end_datetime'):
            value, present = _parse_schedule_value(payload, field, allow_null=True)
            if present:
                if value is False:
                    vals[field] = False
                else:
                    vals[field], schedule_days[field] = value
        current_start = vals.get('start_datetime', meeting.start_datetime)
        current_end = vals.get('end_datetime', meeting.end_datetime)
        _validate_schedule_range(current_start, current_end)
        start_was_cleared = vals.get('start_datetime') is False
        if vals.get('start_datetime'):
            day = _resolve_meeting_date(
                vals.get('meeting_date') if 'meeting_date' in payload else None,
                vals['start_datetime'],
                provided='meeting_date' in payload,
                start_day=schedule_days.get('start_datetime'),
            )
            vals['meeting_date'] = day
        elif 'meeting_date' in payload and meeting.start_datetime and not start_was_cleared:
            _resolve_meeting_date(
                vals['meeting_date'], meeting.start_datetime,
                provided=True,
            )
        if 'meeting_url' in payload:
            vals['meeting_url'] = _parse_url(payload['meeting_url'])
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
            'deadline': _parse_deadline(deadline),
        }
        if priority is not None:
            if not isinstance(priority, str) or priority not in {'0', '1', '2', '3'}:
                raise ApiError(422, 'invalid', 'priority must be one of 0, 1, 2, or 3', field='priority')
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
        if 'deadline' in payload:
            vals['deadline'] = _parse_deadline(payload['deadline'])
        if payload.get('responsible_id'):
            vals['responsible_id'] = parse_positive_int(payload['responsible_id'], 'responsible_id')
        if 'priority' in payload:
            if not isinstance(payload['priority'], str) or payload['priority'] not in {'0', '1', '2', '3'}:
                raise ApiError(422, 'invalid', 'priority must be one of 0, 1, 2, or 3', field='priority')
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
