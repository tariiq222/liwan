# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meeting wire shapes.

Links to other applications (a project, a converted task) come from the
``webvue.meeting.links`` hooks; without a bridge they are null and every
shape stays the same.
"""
from datetime import date, datetime

from odoo import fields

from odoo.addons.webvue_api.serializers.common import iso


def dump_person(user):
    return {'id': user.id, 'name': user.name} if user else None


def _links(record):
    return record.env['webvue.meeting.links']


def dump_minutes_form(meeting, form):
    if not isinstance(form, dict):
        return None
    links = _links(meeting)
    topics = []
    for topic in form.get('topics', []):
        if not isinstance(topic, dict):
            continue
        project_id = topic.get('project_id')
        topics.append({
            'key': topic.get('key', ''),
            'title': topic.get('title', ''),
            'discussion': topic.get('discussion', ''),
            'project_id': project_id if not project_id or links._webvue_project_ref_by_id(meeting, project_id) else None,
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


def _visible_snapshot_rows(meeting, snapshot):
    """The snapshot's resolution rows whose recommendation the caller may read now.

    Same visibility as ``dump_previous_resolutions``: a row of an earlier occurrence
    the caller cannot open stays out of the version history and the frozen minutes.
    """
    rows = [row for row in snapshot.get('resolutions', []) if isinstance(row, dict) and row.get('id')]
    Resolution = meeting.env['webvue.meeting.resolution']
    visible = Resolution.browse([row['id'] for row in rows]).exists()._filtered_access('read')
    visible_ids = set(visible.ids)
    return [row for row in rows if row['id'] in visible_ids], visible


def dump_snapshot_payload(meeting, snapshot):
    """Project a server-built snapshot through current visibility rules."""
    if not isinstance(snapshot, dict):
        return None
    links = _links(meeting)
    snapshot_rows, resolutions = _visible_snapshot_rows(meeting, snapshot)
    readable = links._webvue_readable_links(resolutions)
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
                    if row.get('id') in readable
                    and readable[row.get('id')]['task_id'] == (row.get('task_provenance') or {}).get('task_id')
                    else row.get('state', 'open')
                ),
                'responsible': row.get('responsible'),
                'result': row.get('result', ''),
                'meeting_name': row.get('meeting_name', snapshot.get('name', '')),
                'execution_period': row.get('execution_period') or '',
                'project': row.get('project') or links._webvue_project_ref_by_id(meeting, row.get('project_id')),
            }
            for row in snapshot_rows
        ],
    }
    form = dump_minutes_form(meeting, snapshot.get('minutes_form'))
    if form is not None:
        result['minutes_form'] = form
    return result


def dump_minutes_snapshot(meeting):
    """A completed meeting's frozen payload, already projected by ``_compute_minutes_snapshot``."""
    return meeting.minutes_snapshot or None


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


def _resolution_allowed_actions(resolution, *, linked, manager=None):
    if linked:
        return []
    meeting = resolution.meeting_id
    if meeting.state == 'cancelled':
        return []
    manager = resolution._webvue_is_manager() if manager is None else manager
    editor = manager or resolution.env.user in (meeting.organizer_id | meeting.secretary_id)
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


def dump_resolution(resolution, link=None, *, linked_ids=None, manager=None):
    """``link`` is this recommendation's entry of ``_webvue_readable_links``, when the caller can read it."""
    links = _links(resolution)
    linked = bool(link) or resolution.id in (links._webvue_linked_resolution_ids(resolution) if linked_ids is None else linked_ids)
    execution_state = link['state'] if link else resolution.state
    allowed_actions = _resolution_allowed_actions(
        resolution, linked=linked, manager=manager,
    )
    return {
        'id': resolution.id,
        'name': resolution.name,
        'deadline': str(resolution.deadline) if resolution.deadline else None,
        'priority': resolution.priority,
        'state': resolution.state,
        'responsible': dump_person(resolution.responsible_id),
        'task_id': link['task_id'] if link else None,
        'result': resolution.result or '',
        'can_update_execution': bool(set(allowed_actions) & {'start', 'complete', 'cancel'}),
        'can_edit_decision': bool(resolution.can_edit_decision) and not linked,
        'execution_state': execution_state,
        'task_linked': linked,
        'allowed_actions': allowed_actions,
        'execution_period': resolution.execution_period or '',
        'project': links._webvue_project_ref(resolution),
    }


def _meeting_order_key(meeting):
    day = meeting.meeting_date or date.min
    start = meeting.start_datetime or datetime.min
    return day, start, meeting.id


def projected_resolution_counts(meetings):
    """``{meeting_id: (open, overdue)}`` of ``meetings``: one recommendation read and one links lookup for the whole set."""
    resolutions = meetings.resolution_ids
    readable = _links(meetings)._webvue_readable_links(resolutions)
    today = fields.Date.context_today(meetings)
    counts = {meeting.id: [0, 0] for meeting in meetings}
    for resolution in resolutions:
        link = readable.get(resolution.id)
        state = link['state'] if link else resolution.state
        if state in ('done', 'cancelled'):
            continue
        entry = counts[resolution.meeting_id.id]
        entry[0] += 1
        if resolution.deadline and resolution.deadline < today:
            entry[1] += 1
    return {meeting_id: tuple(entry) for meeting_id, entry in counts.items()}


def dump_meeting(meeting, *, detail=False, counts=None):
    """``counts`` is ``projected_resolution_counts`` of a set that contains ``meeting``, when the caller dumps a list."""
    links = _links(meeting)
    if counts is None:
        counts = projected_resolution_counts(meeting)
    payload = {
        'id': meeting.id,
        'name': meeting.name,
        'reference': meeting.reference,
        'meeting_date': str(meeting.meeting_date) if meeting.meeting_date else None,
        'start_datetime': iso(meeting.start_datetime),
        'end_datetime': iso(meeting.end_datetime),
        'state': meeting.state,
        'organizer': dump_person(meeting.organizer_id),
        'open_resolution_count': counts[meeting.id][0],
        'series_id': meeting.series_id.id or None,
        'project_id': links._webvue_project_id(meeting),
    }
    if detail:
        readable = links._webvue_readable_links(meeting.resolution_ids)
        payload.update({
            'write_date': iso(meeting.write_date),
            'agenda': meeting.agenda or '',
            'minutes': meeting.minutes or '',
            'location': meeting.location or '',
            'meeting_url': meeting.meeting_url or '',
            'can_edit': bool(meeting.can_edit),
            'can_manage': bool(meeting.can_manage),
            'secretary': dump_person(meeting.secretary_id),
            'attendees': [dump_person(user) for user in meeting.attendee_ids],
            'resolutions': [
                dump_resolution(item, readable.get(item.id))
                for item in meeting.resolution_ids
            ],
            'series': dump_person(meeting.series_id) if meeting.series_id else None,
            'project': links._webvue_project_ref(meeting),
            'previous_resolutions': dump_previous_resolutions(meeting),
            'minutes_snapshot': dump_minutes_snapshot(meeting),
        })
        form = dump_minutes_form(meeting, meeting.sudo().minutes_form_data)
        if form is not None:
            payload['minutes_form'] = form
    return payload


def dump_meetings(meetings):
    """List rows of ``meetings`` with the recommendation counts computed once for the set."""
    counts = projected_resolution_counts(meetings)
    return [dump_meeting(meeting, counts=counts) for meeting in meetings]


def dump_previous_resolutions(meeting):
    if not meeting.series_id:
        return []
    rows = []
    current_key = _meeting_order_key(meeting)
    # A search applies the caller's record rules even when another environment
    # of the same transaction has already cached the series' full occurrence list.
    others = meeting.env['webvue.meeting.minute'].search([
        ('series_id', '=', meeting.series_id.id), ('id', '!=', meeting.id),
    ]).filtered(lambda item: _meeting_order_key(item) < current_key)
    readable = _links(meeting)._webvue_readable_links(others.mapped('resolution_ids'))
    for other in others.sorted(key=_meeting_order_key):
        for resolution in other.resolution_ids:
            row = dump_resolution(resolution, readable.get(resolution.id))
            row['meeting_id'] = other.id
            row['meeting_name'] = other.name
            rows.append(row)
    return rows


def dump_series(series, *, detail=False, counts=None):
    """``counts`` is ``projected_resolution_counts`` of a set that contains every occurrence, when the caller dumps a list."""
    meetings = series.meeting_ids
    if counts is None:
        counts = projected_resolution_counts(meetings)
    payload = {
        'id': series.id,
        'name': series.name,
        'recurrence': series.recurrence,
        'active': series.active,
        'until_date': str(series.until_date) if series.until_date else None,
        'until_count': series.until_count or None,
        'organizer': dump_person(series.organizer_id),
        'project': _links(series)._webvue_project_ref(series),
        'open_resolution_count': sum(counts[meeting.id][0] for meeting in meetings),
        'overdue_resolution_count': sum(counts[meeting.id][1] for meeting in meetings),
    }
    if detail:
        payload.update({
            'location': series.location or '',
            'meeting_url': series.meeting_url or '',
            'secretary': dump_person(series.secretary_id),
            'attendees': [dump_person(user) for user in series.attendee_ids],
            'meetings': [dump_meeting(meeting, counts=counts) for meeting in meetings.sorted(key=_meeting_order_key)],
            'can_edit': bool(series._webvue_is_editor()),
        })
    return payload
