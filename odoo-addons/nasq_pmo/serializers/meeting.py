# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo.exceptions import AccessError

from odoo.addons.nasq_api.serializers.common import iso


def dump_person(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_project_ref(record):
    project = record.project_id
    if not project:
        return None
    service = record.env['nasq.access.service']
    if not service._nasq_has_capability(record.env.user, 'pmo.projects.read'):
        return None
    try:
        project.check_access('read')
    except AccessError:
        return None
    return {'id': project.id, 'name': project.name}


def dump_resolution(resolution, task_id=None):
    has_task = bool(task_id or resolution.env['project.task'].with_context(active_test=False).sudo().search_count(
        [('resolution_id', '=', resolution.id)], limit=1,
    ))
    return {
        'id': resolution.id,
        'name': resolution.name,
        'deadline': str(resolution.deadline) if resolution.deadline else None,
        'priority': resolution.priority,
        'state': resolution.state,
        'responsible': dump_person(resolution.responsible_id),
        'task_id': task_id,
        'result': resolution.result or '',
        'can_update_execution': bool(resolution.can_update_execution) and not has_task,
        'can_edit_decision': bool(resolution.can_edit_decision) and not has_task,
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
    ])
    return {task.resolution_id: task.id for task in tasks if task.resolution_id}


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
        'open_resolution_count': meeting.open_resolution_count,
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
        })
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
        'open_resolution_count': sum(meetings.mapped('open_resolution_count')),
        'overdue_resolution_count': sum(meetings.mapped('overdue_resolution_count')),
    }
    if detail:
        payload.update({
            'location': series.location or '',
            'meeting_url': series.meeting_url or '',
            'secretary': dump_person(series.secretary_id),
            'attendees': [dump_person(user) for user in series.attendee_ids],
            'meetings': [dump_meeting(meeting) for meeting in meetings.sorted(key=_meeting_order_key)],
        })
    return payload
