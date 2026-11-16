# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The wire shape of a support ticket and the bodies that create and change one.

Priorities travel as names (``low``…``urgent``) while the engine stores ``0``…``3``. References travel
as ``{id, name}`` pairs, the requester as ``{kind, name, id?}`` where ``kind`` is ``customer`` or
``employee``, and the SLA as the state a screen shows plus the deadline behind it. Nothing here reads a
raw ORM result: every field is named.
"""
from datetime import timedelta

from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso

PRIORITIES = {'0': 'low', '1': 'medium', '2': 'high', '3': 'urgent'}
PRIORITY_VALUES = {name: key for key, name in PRIORITIES.items()}
SLA_SOON = timedelta(hours=4)
CREATE_FIELDS = frozenset({
    'subject', 'description', 'team_id', 'category_id', 'type_id', 'channel_id', 'tag_ids', 'priority',
    'customer_id', 'assignee_id',
})
UPDATE_FIELDS = frozenset({
    'subject', 'description', 'priority', 'category_id', 'type_id', 'channel_id', 'tag_ids', 'team_id',
    'assignee_id', 'related_ids',
})
COMMENT_FIELDS = frozenset({'body', 'internal'})
TICKET_REF_FIELDS = ('team_id', 'stage_id', 'category_id', 'type_id', 'channel_id')


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def _refs(records):
    return [{'id': record.id, 'name': record.name} for record in records]


def priority_name(value):
    return PRIORITIES.get(value, 'medium')


def requester(ticket):
    """Who asked: the employee who opened the request, else the customer contact, else a guest."""
    if ticket.liwan_requester_user_id:
        return {'kind': 'employee', 'id': ticket.liwan_requester_user_id.id,
                'name': ticket.liwan_requester_user_id.name}
    if ticket.partner_id:
        return {'kind': 'customer', 'id': ticket.partner_id.id, 'name': ticket.partner_id.display_name}
    return {'kind': 'guest', 'name': ticket.partner_name or ticket.partner_email or ''}


def sla(ticket, now=None):
    """``{state, deadline, rows}`` of a ticket, from the engine's per-ticket SLA rows."""
    now = now or fields.Datetime.now()
    rows, deadline, state = [], None, 'none'
    for row in ticket.ticket_sla_ids.filtered(lambda item: item.sla_id.active):
        if row.state == 'expired' or (row.state == 'in_progress' and row.deadline and row.deadline < now):
            state = 'overdue'
        elif row.state == 'in_progress':
            if state != 'overdue':
                state = 'due_soon' if row.deadline and row.deadline - now <= SLA_SOON else 'on_track'
            if row.deadline and (deadline is None or row.deadline < deadline):
                deadline = row.deadline
        rows.append({
            'id': row.id, 'name': row.name, 'state': row.state,
            'deadline': iso(row.deadline), 'hours': row.hours,
        })
    return {'state': state, 'deadline': iso(deadline), 'rows': rows}


def first_response(ticket, settings):
    due = None
    if settings.first_response_hours:
        due = ticket.create_date + timedelta(hours=settings.first_response_hours)
    return {'at': iso(ticket.liwan_first_response_at), 'due': iso(due)}


def dump_row(ticket, settings, can_read_type=True):
    return {
        'id': ticket.id,
        'number': ticket.number,
        'subject': ticket.name,
        'team': _ref(ticket.team_id),
        'stage': {'id': ticket.stage_id.id, 'name': ticket.stage_id.name, 'closed': bool(ticket.stage_id.closed)},
        'priority': priority_name(ticket.priority),
        'assignee': {'id': ticket.user_id.id, 'name': ticket.user_id.name} if ticket.user_id else None,
        'requester': requester(ticket),
        'category': _ref(ticket.category_id),
        'type': _ref(ticket.type_id) if can_read_type and 'type_id' in ticket._fields else None,
        'channel': _ref(ticket.channel_id),
        'tags': _refs(ticket.tag_ids),
        'sla': sla(ticket),
        'created_at': iso(ticket.create_date),
        'last_activity_at': iso(ticket.liwan_last_activity_at),
    }


def dump_ticket(ticket, settings, can_read_type=True, portal_link=None):
    return {
        **dump_row(ticket, settings, can_read_type),
        'description': ticket.description or '',
        'related': [{'id': related.id, 'number': related.number, 'subject': related.name}
                    for related in ticket.liwan_related_ticket_ids],
        'first_response': first_response(ticket, settings),
        'assigned_at': iso(ticket.assigned_date),
        'closed_at': iso(ticket.closed_date),
        'portal_link': portal_link,
    }


def parse_create(payload):
    extra = set(payload) - CREATE_FIELDS
    if extra:
        raise ApiError(422, 'invalid', 'field %r is not writable' % sorted(extra)[0], field=sorted(extra)[0])
    values = {
        'subject': payload.get('subject'),
        'description': payload.get('description'),
        'priority': _priority(payload.get('priority')),
    }
    for key in ('team_id', 'category_id', 'type_id', 'channel_id', 'customer_id', 'assignee_id'):
        if payload.get(key) is not None:
            values[key] = _positive(payload[key], key)
    values['tag_ids'] = _ids(payload.get('tag_ids', []), 'tag_ids')
    return values


def parse_update(payload):
    extra = set(payload) - UPDATE_FIELDS
    if extra:
        raise ApiError(422, 'invalid', 'field %r is not writable' % sorted(extra)[0], field=sorted(extra)[0])
    values = dict(payload)
    if 'priority' in values:
        values['priority'] = _priority(values['priority'])
    for key in ('team_id', 'category_id', 'type_id', 'channel_id', 'assignee_id'):
        if key in values:
            values[key] = _positive(values[key], key) if values[key] is not None else None
    if 'tag_ids' in values:
        values['tag_ids'] = _ids(values['tag_ids'], 'tag_ids')
    if 'related_ids' in values:
        values['related_ids'] = _ids(values['related_ids'], 'related_ids')
    return values


def parse_comment(payload):
    extra = set(payload) - COMMENT_FIELDS
    if extra:
        raise ApiError(422, 'invalid', 'field %r is not writable' % sorted(extra)[0], field=sorted(extra)[0])
    internal = payload.get('internal', False)
    if internal is not False and internal is not True:
        raise ApiError(422, 'invalid', 'must be true or false', field='internal')
    return {'body': payload.get('body'), 'internal': internal}


def _priority(value):
    if value is None:
        return None
    if value not in PRIORITY_VALUES:
        raise ApiError(422, 'invalid', 'unknown priority', field='priority')
    return PRIORITY_VALUES[value]


def _positive(value, field):
    if type(value) is not int or value <= 0:
        raise ApiError(422, 'invalid', 'must be a record id', field=field)
    return value


def _ids(value, field):
    if value is None:
        return []
    if not isinstance(value, list) or any(type(item) is not int or item <= 0 for item in value):
        raise ApiError(422, 'invalid', 'must be a list of record ids', field=field)
    return value
