# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_api.serializers.common import iso


def dump_person(user):
    return {'id': user.id, 'name': user.name}


def dump_resolution(resolution, task_id=None):
    return {
        'id': resolution.id,
        'name': resolution.name,
        'deadline': str(resolution.deadline) if resolution.deadline else None,
        'priority': resolution.priority,
        'state': resolution.state,
        'responsible': dump_person(resolution.responsible_id) if resolution.responsible_id else None,
        'task_id': task_id,
    }


def dump_meeting(meeting, *, detail=False):
    payload = {
        'id': meeting.id,
        'name': meeting.name,
        'reference': meeting.reference,
        'meeting_date': str(meeting.meeting_date) if meeting.meeting_date else None,
        'state': meeting.state,
        'organizer': dump_person(meeting.organizer_id) if meeting.organizer_id else None,
    }
    if detail:
        tasks = meeting.env['project.task'].search([('resolution_id', 'in', meeting.resolution_ids.ids)])
        task_by_resolution = {task.resolution_id: task.id for task in tasks}
        payload['agenda'] = meeting.agenda or ''
        payload['minutes'] = meeting.minutes or ''
        payload['location'] = meeting.location or ''
        payload['start_datetime'] = iso(meeting.start_datetime)
        payload['end_datetime'] = iso(meeting.end_datetime)
        payload['meeting_url'] = meeting.meeting_url or ''
        payload['can_edit'] = bool(meeting.can_edit or meeting.can_manage)
        payload['secretary'] = dump_person(meeting.secretary_id) if meeting.secretary_id else None
        payload['attendees'] = [dump_person(user) for user in meeting.attendee_ids]
        payload['resolutions'] = [
            dump_resolution(item, task_by_resolution.get(item.id))
            for item in meeting.resolution_ids
        ]
    return payload
