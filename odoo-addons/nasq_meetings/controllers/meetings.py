# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

from odoo import fields, http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_nonneg_int,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.nasq_meetings.serializers.meeting import (
    dump_meeting,
    dump_meetings,
    dump_resolution,
)

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


def _validate_internal_user(user_id, field):
    parsed = parse_positive_int(user_id, field)
    if not request.env['nasq.directory']._nasq_people([parsed]):
        raise ApiError(422, 'invalid', '%s must be an active internal user in the current company' % field, field=field)
    return parsed


def _validate_internal_users(user_ids, field):
    if not isinstance(user_ids, list):
        raise ApiError(422, 'invalid', '%s must be a list' % field, field=field)
    parsed = [parse_positive_int(item, field) for item in user_ids]
    if not parsed:
        return []
    users = request.env['nasq.directory']._nasq_people(parsed)
    if set(users.ids) != set(parsed):
        raise ApiError(422, 'invalid', '%s must contain only active internal users in the current company' % field, field=field)
    return parsed


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


def _require_editor(meeting):
    """403 before the vendor model answers an attendee's edit with its own error."""
    if not (meeting.can_manage or request.env.user in (meeting.organizer_id | meeting.secretary_id)):
        raise ApiError(403, 'forbidden', 'only the organizer, secretary or a meetings manager may edit this meeting')


def _require_manager(meeting):
    """403 before the vendor model answers a non-manager's transition with a 422."""
    if not meeting.can_manage:
        raise ApiError(403, 'forbidden', 'only a meetings manager may complete, cancel or reopen a meeting')


def _check_write_date(meeting, value):
    """409 ``conflict`` when the caller's copy of the meeting is older than the stored one.

    Compared at second precision, the precision of the ``write_date`` the detail payload carries.
    """
    if _parse_dt(value, 'write_date') != fields.Datetime.to_string(meeting.write_date):
        raise ApiError(409, 'conflict', 'the meeting was changed by someone else; reload it before saving', field='write_date')


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
    @requires_feature('meetings.enabled', operation='read')
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
            domain += [
                '|', '|',
                ('name', 'ilike', q),
                ('reference', 'ilike', q),
                ('location', 'ilike', q),
            ]
        if args.get('state'):
            if args.get('state') not in STATES:
                raise ApiError(422, 'invalid', 'invalid state', field='state')
            domain.append(('state', '=', args.get('state')))
        parsed_date_from = _parse_day(date_from, 'date_from') if date_from else None
        parsed_date_to = _parse_day(date_to, 'date_to') if date_to else None
        if parsed_date_from and parsed_date_to and parsed_date_from > parsed_date_to:
            raise ApiError(422, 'invalid', 'date_to must be on or after date_from', field='date_to')
        if parsed_date_from:
            domain.append(('meeting_date', '>=', parsed_date_from))
        if parsed_date_to:
            domain.append(('meeting_date', '<=', parsed_date_to))
        if args.get('organizer_id'):
            domain.append(('organizer_id', '=', parse_positive_int(args.get('organizer_id'), 'organizer_id')))
        if args.get('project_id'):
            domain += request.env['nasq.meeting.links']._nasq_project_domain(
                parse_positive_int(args.get('project_id'), 'project_id'),
            )
        if args.get('series_id'):
            domain.append(('series_id', '=', parse_positive_int(args.get('series_id'), 'series_id')))
        if args.get('mine') in {'1', 'true'}:
            uid = request.env.uid
            domain += ['|', '|', ('organizer_id', '=', uid), ('secretary_id', '=', uid), ('attendee_ids', 'in', [uid])]
        Meeting = request.env['cyan.meeting.minute']
        records = Meeting.search(domain, order='meeting_date desc, id desc', limit=limit, offset=offset)
        return {
            'items': dump_meetings(records),
            'total': Meeting.search_count(domain),
        }

    @http.route('/api/v1/meetings/<int:meeting_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('meetings.enabled', operation='read')
    def get_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def create_meeting(self, name=None, meeting_date=None, location=None, start_datetime=None, end_datetime=None, meeting_url=None, attendee_ids=None, secretary_id=None, agenda=None, series_id=None, project_id=None, minutes_form=None, **extra):
        request.env['nasq.access.service']._nasq_require_capability('meetings.create')
        if extra:
            raise ApiError(422, 'invalid', 'unsupported meeting fields: %s' % ', '.join(sorted(extra)))
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
                else _validate_internal_user(secretary_id, 'secretary_id')
            )
        if attendee_ids is not None:
            vals['attendee_ids'] = [(6, 0, _validate_internal_users(attendee_ids, 'attendee_ids'))]
        if isinstance(agenda, str):
            vals['agenda'] = agenda
        if series_id:
            vals['series_id'] = parse_positive_int(series_id, 'series_id')
        if project_id:
            vals.update(request.env['nasq.meeting.links']._nasq_project_vals(
                parse_positive_int(project_id, 'project_id'),
            ))
        with request.env.cr.savepoint():
            meeting = request.env['cyan.meeting.minute'].create(vals)
            if minutes_form is not None:
                meeting._nasq_set_minutes_form(minutes_form)
        return request.make_json_response(dump_meeting(meeting, detail=True), status=201)

    @http.route('/api/v1/meetings/<int:meeting_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def patch_meeting(self, meeting_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        _require_editor(meeting)
        payload.pop('meeting_id', None)
        allowed = {
            'name', 'location', 'agenda', 'minutes', 'meeting_date', 'secretary_id',
            'attendee_ids', 'start_datetime', 'end_datetime', 'meeting_url',
            'series_id', 'project_id', 'scope', 'minutes_form', 'write_date',
        }
        unsupported = set(payload) - allowed
        if unsupported:
            raise ApiError(422, 'invalid', 'unsupported meeting fields: %s' % ', '.join(sorted(unsupported)))
        if 'write_date' in payload:
            _check_write_date(meeting, payload['write_date'])
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
            vals['secretary_id'] = _validate_internal_user(payload['secretary_id'], 'secretary_id') if payload['secretary_id'] else False
        if 'attendee_ids' in payload:
            vals['attendee_ids'] = [(6, 0, _validate_internal_users(payload['attendee_ids'], 'attendee_ids'))]
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
        if 'series_id' in payload:
            vals['series_id'] = (
                parse_positive_int(payload['series_id'], 'series_id')
                if payload['series_id'] is not None else False
            )
        if 'project_id' in payload:
            project_id = parse_positive_int(payload['project_id'], 'project_id') if payload['project_id'] else False
            vals.update(request.env['nasq.meeting.links']._nasq_project_vals(project_id))
        has_minutes_form = 'minutes_form' in payload
        if has_minutes_form:
            meeting._nasq_validate_minutes_form(payload['minutes_form'])
        if not vals and not has_minutes_form:
            raise ApiError(422, 'invalid', 'no fields to update')
        scope = payload.get('scope') or 'this'
        if scope not in {'this', 'this_and_following'}:
            raise ApiError(422, 'invalid', 'invalid scope', field='scope')
        with request.env.cr.savepoint():
            if scope == 'this_and_following' and vals:
                meeting.action_apply_schedule_scope(vals, scope)
            elif vals:
                meeting.write(vals)
            if has_minutes_form:
                meeting._nasq_set_minutes_form(payload['minutes_form'])
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def cancel_meeting(self, meeting_id, scope='this', **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        _require_manager(meeting)
        if scope not in {'this', 'this_and_following'}:
            raise ApiError(422, 'invalid', 'invalid scope', field='scope')
        try:
            meeting.action_cancel_scope(scope)
        except UserError as e:
            raise ApiError(403, 'transition_forbidden', str(e)) from e
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/resolutions', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def create_resolution(self, meeting_id, name=None, responsible_id=None, deadline=None, priority=None, execution_period=None, project_id=None, **extra):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        if extra:
            raise ApiError(422, 'invalid', 'unsupported resolution fields: %s' % ', '.join(sorted(extra)))
        meeting = get_record('cyan.meeting.minute', meeting_id)
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        if deadline is not None and (not isinstance(deadline, str) or not deadline.strip()):
            raise ApiError(422, 'invalid', 'deadline must be YYYY-MM-DD or null', field='deadline')
        if execution_period is not None and (not isinstance(execution_period, str) or len(execution_period) > 500):
            raise ApiError(422, 'invalid', 'execution_period must be a string of at most 500 characters', field='execution_period')
        if not (deadline and deadline.strip()) and not (execution_period or '').strip():
            raise ApiError(422, 'invalid', 'deadline or execution_period is required', field='deadline')
        vals = {
            'meeting_id': meeting.id,
            'name': name.strip(),
            'responsible_id': parse_positive_int(responsible_id, 'responsible_id'),
            'deadline': _parse_deadline(deadline) if deadline else False,
        }
        if execution_period is not None:
            vals['execution_period'] = execution_period.strip()
        if project_id is not None:
            links = request.env['nasq.meeting.links']
            vals.update(links._nasq_project_vals(
                links._nasq_check_project(parse_positive_int(project_id, 'project_id')),
            ))
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

    def _resolution(self, meeting_id, resolution_id):
        meeting = get_record('cyan.meeting.minute', meeting_id)
        resolution = get_record('cyan.meeting.resolution', resolution_id)
        if resolution.meeting_id != meeting:
            raise ApiError(404, 'not_found', 'resolution not found')
        return meeting, resolution

    @http.route('/api/v1/meetings/<int:meeting_id>/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def confirm_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        meeting.action_confirm()
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/complete', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def complete_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        _require_manager(meeting)
        gap = meeting._nasq_completion_gap()
        if gap:
            field, message = gap
            raise ApiError(422, 'invalid', message, field=field)
        meeting.action_done()
        return dump_meeting(meeting, detail=True)

    @http.route('/api/v1/meetings/<int:meeting_id>/reopen', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def reopen_meeting(self, meeting_id, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        meeting = get_record('cyan.meeting.minute', meeting_id)
        _require_manager(meeting)
        meeting.action_reset_draft()
        return dump_meeting(meeting, detail=True)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def patch_resolution(self, meeting_id, resolution_id, **payload):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        _meeting, resolution = self._resolution(meeting_id, resolution_id)
        payload.pop('meeting_id', None)
        allowed = {'name', 'deadline', 'responsible_id', 'priority', 'result', 'execution_period', 'project_id'}
        unsupported = set(payload) - allowed
        if unsupported:
            raise ApiError(422, 'invalid', 'unsupported resolution fields: %s' % ', '.join(sorted(unsupported)))
        vals = {}
        if 'name' in payload:
            if not isinstance(payload['name'], str) or not payload['name'].strip():
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
            vals['name'] = payload['name'].strip()
        if 'deadline' in payload:
            vals['deadline'] = _parse_deadline(payload['deadline']) if payload['deadline'] else False
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
        if 'execution_period' in payload:
            if payload['execution_period'] is not None and (not isinstance(payload['execution_period'], str) or len(payload['execution_period']) > 500):
                raise ApiError(422, 'invalid', 'execution_period must be a string of at most 500 characters', field='execution_period')
            vals['execution_period'] = (payload['execution_period'] or '').strip()
        if 'project_id' in payload:
            links = request.env['nasq.meeting.links']
            project_id = (
                links._nasq_check_project(parse_positive_int(payload['project_id'], 'project_id'))
                if payload['project_id'] else False
            )
            vals.update(links._nasq_project_vals(project_id))
        if 'deadline' in payload or 'execution_period' in payload:
            proposed_deadline = vals.get('deadline', resolution.deadline)
            proposed_period = vals.get('execution_period', resolution.execution_period)
            if not proposed_deadline and not (proposed_period or '').strip():
                raise ApiError(422, 'invalid', 'deadline or execution_period is required', field='deadline')
        if not vals:
            raise ApiError(422, 'invalid', 'no fields to update')
        resolution.write(vals)
        return dump_resolution(resolution)

    @http.route(
        '/api/v1/meetings/<int:meeting_id>/resolutions/<int:resolution_id>/<string:action>',
        type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('meetings.enabled', operation='write')
    def resolution_action(self, meeting_id, resolution_id, action, **_):
        request.env['nasq.access.service']._nasq_require_capability('meetings.read')
        _meeting, resolution = self._resolution(meeting_id, resolution_id)
        methods = {'start': 'action_start', 'complete': 'action_done', 'cancel': 'action_cancel', 'reopen': 'action_reopen'}
        if action not in methods:
            raise ApiError(404, 'not_found', 'unknown action')
        getattr(resolution, methods[action])()
        return dump_resolution(resolution)

    @http.route('/api/v1/meetings/<int:meeting_id>/minutes.pdf', type='http', auth='user', methods=['GET'], csrf=False)
    @requires_feature('meetings.enabled', operation='read')
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
