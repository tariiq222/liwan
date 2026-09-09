# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo import fields
from odoo.exceptions import AccessError

from odoo.addons.nasq_api.serializers.common import iso


def dump_person(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_project_ref(record):
    project = record.project_id
    if not project:
        return None
    if project.company_id != record.env.company:
        return None
    service = record.env['nasq.access.service']
    if not service._nasq_has_capability(record.env.user, 'pmo.projects.read'):
        return None
    try:
        project.check_access('read')
    except AccessError:
        return None
    return {'id': project.id, 'name': project.name}


def dump_project_id(record, project_id):
    if not project_id:
        return None
    project = record.env['project.project'].browse(project_id).exists()
    if not project or project.company_id != record.env.company:
        return None
    service = record.env['nasq.access.service']
    if not service._nasq_has_capability(record.env.user, 'pmo.projects.read'):
        return None
    try:
        project.check_access('read')
    except AccessError:
        return None
    return {'id': project.id, 'name': project.name}


def dump_minutes_form(meeting, form):
    if not isinstance(form, dict):
        return None
    topics = []
    for topic in form.get('topics', []):
        if not isinstance(topic, dict):
            continue
        topics.append({
            'key': topic.get('key', ''),
            'title': topic.get('title', ''),
            'discussion': topic.get('discussion', ''),
            'project_id': topic.get('project_id') if not topic.get('project_id') or dump_project_id(meeting, topic.get('project_id')) else None,
            'resolution_ids': list(topic.get('resolution_ids') or []),
        })
    return {
        'opening': form.get('opening', ''),
        'closing': form.get('closing', ''),
        'chairperson': form.get('chairperson', ''),
        'approver_name': form.get('approver_name', ''),
        'approver_title': form.get('approver_title', ''),
        'topics': topics,
    }


TASK_EXECUTION_STATES = {
    '1_done': 'done',
    '1_canceled': 'cancelled',
}


def _task_execution_state(task):
    return TASK_EXECUTION_STATES.get(task.state, 'in_progress')


def dump_snapshot_payload(meeting, snapshot):
    """Project a server-built snapshot through current visibility rules."""
    if not isinstance(snapshot, dict):
        return None
    snapshot_rows = [row for row in snapshot.get('resolutions', []) if isinstance(row, dict)]
    task_by_resolution = {}
    resolution_ids = [row.get('id') for row in snapshot_rows if row.get('id')]
    if resolution_ids:
        resolutions = meeting.env['cyan.meeting.resolution'].browse(resolution_ids).exists()
        readable_ids = _readable_task_ids_by_resolution(meeting, resolutions)
        if readable_ids:
            tasks = meeting.env['project.task'].browse(set(readable_ids.values())).exists()
            task_by_resolution = {task.resolution_id: task for task in tasks if task.resolution_id}
    result = {
        'captured_at': snapshot.get('captured_at'),
        'name': snapshot.get('name', ''),
        'meeting_date': snapshot.get('meeting_date'),
        'start_datetime': snapshot.get('start_datetime'),
        'end_datetime': snapshot.get('end_datetime'),
        'location': snapshot.get('location', ''),
        'organizer': snapshot.get('organizer'),
        'secretary': snapshot.get('secretary'),
        'attendees': snapshot.get('attendees') or [],
        'agenda': snapshot.get('agenda', ''),
        'minutes': snapshot.get('minutes', ''),
        'resolutions': [
            {
                'id': row.get('id'),
                'name': row.get('name', ''),
                'deadline': row.get('deadline'),
                'priority': row.get('priority', '0'),
                'state': (
                    row.get('projected_state', row.get('state', 'open'))
                    if row.get('id') in task_by_resolution
                    and task_by_resolution[row.get('id')].id == (row.get('task_provenance') or {}).get('task_id')
                    else row.get('state', 'open')
                ),
                'responsible': row.get('responsible'),
                'result': row.get('result', ''),
                'meeting_name': row.get('meeting_name', snapshot.get('name', '')),
                'execution_period': row.get('execution_period') or '',
                'project': row.get('project') or dump_project_id(meeting, row.get('project_id')),
            }
            for row in snapshot.get('resolutions', [])
            if isinstance(row, dict)
        ],
    }
    form = dump_minutes_form(meeting, snapshot.get('minutes_form'))
    if form is not None:
        result['minutes_form'] = form
    return result


def dump_minutes_snapshot(meeting):
    """Expose only a completed meeting's frozen, server-built payload."""
    if meeting.state != 'done' or not isinstance(meeting.minutes_snapshot, dict):
        return None
    return dump_snapshot_payload(meeting, meeting.minutes_snapshot)


def dump_event(event, meeting=None):
    meeting = meeting or event.meeting_id
    return {
        'id': event.id,
        'meeting_id': meeting.id,
        'meeting_name': meeting.name,
        'occurred_at': iso(event.occurred_at),
        'actor': dump_person(event.actor_id),
        'kind': event.kind,
        'summary': event.summary,
    }


def dump_version(version):
    meeting = version.meeting_id
    meeting.check_access('read')
    snapshot = version.sudo().snapshot
    return {
        'id': version.id,
        'number': version.number,
        'captured_at': iso(version.captured_at),
        'actor': dump_person(version.actor_id),
        'snapshot': dump_snapshot_payload(meeting, snapshot),
    }


def _resolution_allowed_actions(resolution, *, linked, task_readable):
    if linked:
        return []
    meeting = resolution.meeting_id
    if meeting.state == 'cancelled':
        return []
    manager = resolution._cyan_is_manager()
    editor = resolution._cyan_is_meeting_editor(meeting)
    assignee = resolution.env.user == resolution.responsible_id
    if resolution.state in ('done', 'cancelled'):
        return ['reopen'] if manager else []
    if not editor and not assignee:
        return []
    actions = []
    if resolution.state == 'open':
        actions.append('start')
    actions.append('complete')
    if editor:
        actions.append('cancel')
    actions.append('edit_result')
    return actions


def dump_resolution(resolution, task_id=None):
    has_task = bool(task_id or resolution.env['project.task'].with_context(active_test=False).sudo().search_count(
        [('resolution_id', '=', resolution.id)], limit=1,
    ))
    task = resolution.env['project.task'].browse(task_id).exists() if task_id else resolution.env['project.task']
    execution_state = _task_execution_state(task) if task else resolution.state
    allowed_actions = _resolution_allowed_actions(
        resolution, linked=has_task, task_readable=bool(task),
    )
    return {
        'id': resolution.id,
        'name': resolution.name,
        'deadline': str(resolution.deadline) if resolution.deadline else None,
        'priority': resolution.priority,
        'state': resolution.state,
        'responsible': dump_person(resolution.responsible_id),
        'task_id': task_id,
        'result': resolution.result or '',
        'can_update_execution': bool(set(allowed_actions) & {'start', 'complete', 'cancel'}),
        'can_edit_decision': bool(resolution.can_edit_decision) and not has_task,
        'execution_state': execution_state,
        'task_linked': has_task,
        'allowed_actions': allowed_actions,
        'execution_period': resolution.execution_period or '',
        'project': dump_project_ref(resolution) if resolution.project_id else None,
    }


def _meeting_order_key(meeting):
    day = meeting.meeting_date or date.min
    start = meeting.start_datetime or datetime.min
    return day, start, meeting.id


def _readable_task_ids_by_resolution(meeting, resolutions):
    Task = meeting.env['project.task']
    can_read_tasks = meeting.env['nasq.access.service']._nasq_has_capability(
        meeting.env.user, 'pmo.tasks.read',
    ) and Task.has_access('read')
    if not can_read_tasks or not resolutions:
        return {}
    tasks = Task.search([
        ('resolution_id', 'in', resolutions.ids),
        ('company_id', '=', meeting.env.company.id),
        ('project_id.company_id', '=', meeting.env.company.id),
        ('project_id.active', '=', True),
        ('active', '=', True),
    ])
    return {task.resolution_id: task.id for task in tasks if task.resolution_id}


def _projected_resolution_counts(meeting, resolutions=None):
    resolutions = resolutions if resolutions is not None else meeting.resolution_ids
    task_by_resolution = _readable_task_ids_by_resolution(meeting, resolutions)
    now = fields.Date.context_today(meeting)
    open_count = overdue_count = 0
    for resolution in resolutions:
        task_id = task_by_resolution.get(resolution.id)
        task = meeting.env['project.task'].browse(task_id).exists() if task_id else meeting.env['project.task']
        state = _task_execution_state(task) if task else resolution.state
        if state in ('done', 'cancelled'):
            continue
        open_count += 1
        if resolution.deadline and resolution.deadline < now:
            overdue_count += 1
    return open_count, overdue_count


def dump_meeting(meeting, *, detail=False):
    payload = {
        'id': meeting.id,
        'name': meeting.name,
        'reference': meeting.reference,
        'meeting_date': str(meeting.meeting_date) if meeting.meeting_date else None,
        'start_datetime': iso(meeting.start_datetime),
        'end_datetime': iso(meeting.end_datetime),
        'state': meeting.state,
        'organizer': dump_person(meeting.organizer_id),
        'open_resolution_count': _projected_resolution_counts(meeting)[0],
        'series_id': meeting.series_id.id or None,
        'project_id': meeting.project_id.id or None,
    }
    if detail:
        task_by_resolution = _readable_task_ids_by_resolution(meeting, meeting.resolution_ids)
        payload.update({
            'agenda': meeting.agenda or '',
            'minutes': meeting.minutes or '',
            'location': meeting.location or '',
            'meeting_url': meeting.meeting_url or '',
            'can_edit': bool(meeting.can_edit),
            'can_manage': bool(meeting.can_manage),
            'secretary': dump_person(meeting.secretary_id),
            'attendees': [dump_person(user) for user in meeting.attendee_ids],
            'resolutions': [
                dump_resolution(item, task_by_resolution.get(item.id))
                for item in meeting.resolution_ids
            ],
            'series': dump_person(meeting.series_id) if meeting.series_id else None,
            'project': dump_project_ref(meeting),
            'previous_resolutions': dump_previous_resolutions(meeting),
            'minutes_snapshot': dump_minutes_snapshot(meeting),
        })
        form = dump_minutes_form(meeting, meeting.sudo().minutes_form_data)
        if form is not None:
            payload['minutes_form'] = form
    return payload


def dump_previous_resolutions(meeting):
    if not meeting.series_id:
        return []
    rows = []
    current_key = _meeting_order_key(meeting)
    others = meeting.series_id.meeting_ids.filtered(
        lambda item: item.id != meeting.id and _meeting_order_key(item) < current_key,
    )
    task_by_resolution = _readable_task_ids_by_resolution(meeting, others.mapped('resolution_ids'))
    for other in others.sorted(key=_meeting_order_key):
        for resolution in other.resolution_ids:
            row = dump_resolution(resolution, task_by_resolution.get(resolution.id))
            row['meeting_id'] = other.id
            row['meeting_name'] = other.name
            rows.append(row)
    return rows


def dump_series(series, *, detail=False):
    meetings = series.meeting_ids
    payload = {
        'id': series.id,
        'name': series.name,
        'recurrence': series.recurrence,
        'until_date': str(series.until_date) if series.until_date else None,
        'until_count': series.until_count or None,
        'organizer': dump_person(series.organizer_id),
        'project': dump_project_ref(series),
        'open_resolution_count': sum(_projected_resolution_counts(meeting)[0] for meeting in meetings),
        'overdue_resolution_count': sum(_projected_resolution_counts(meeting)[1] for meeting in meetings),
    }
    if detail:
        payload.update({
            'location': series.location or '',
            'meeting_url': series.meeting_url or '',
            'secretary': dump_person(series.secretary_id),
            'attendees': [dump_person(user) for user in series.attendee_ids],
            'meetings': [dump_meeting(meeting) for meeting in meetings.sorted(key=_meeting_order_key)],
            'can_edit': bool(series._nasq_is_editor()),
        })
    return payload
