# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Personal task wire shapes (the contract is packages/contracts/src/tasks).

Every shape whitelists its fields; none is a raw ``read()``. All of it runs in
the caller's environment, so what the caller cannot read is left out.
"""
from odoo.exceptions import AccessError
from odoo.tools import html2plaintext

from odoo.addons.nasq_api.serializers.common import iso
from odoo.addons.nasq_tasks.models.my_task_service import STATE_TO_WIRE

PRIORITY_TO_WIRE = {'0': 'normal', '1': 'high'}
CLOSED_WIRE = {'1_done': 'done', '1_canceled': 'cancelled'}


def list_state(state):
    """Wire state of a list row. Other applications' tasks carry states of their own
    (PMO: changes requested, approved, waiting...); every non-closed one reads as open."""
    return CLOSED_WIRE.get(state, 'open')


def list_priority(priority):
    return PRIORITY_TO_WIRE.get(priority or '0', 'normal')


def _person(user):
    """The ``/api/v1/people`` person shape (``id`` and ``user_id`` are ``res.users`` ids)."""
    return {'id': user.id, 'name': user.name, 'user_id': user.id}


def _task_ref(task):
    return {'id': task.id, 'name': task.name}


def _readable_parent(task):
    parent = task.nasq_parent_id
    if not parent:
        return None
    try:
        return _task_ref(parent) if parent.has_access('read') else None
    except AccessError:
        return None


def dump_personal_task(task):
    attachments = task.env['ir.attachment'].search_count([
        ('res_model', '=', 'project.task'), ('res_id', '=', task.id)])
    return {
        'id': task.id,
        'name': task.name,
        'description': html2plaintext(task.description or '').strip(),
        'state': STATE_TO_WIRE[task.state],
        'priority': PRIORITY_TO_WIRE[task.priority or '0'],
        'date_deadline': iso(task.date_deadline),
        'assignees': [_person(user) for user in task.user_ids],
        'creator': _person(task.create_uid),
        'parent': _readable_parent(task),
        'subtasks': [
            {**_task_ref(child), 'state': STATE_TO_WIRE[child.state]}
            for child in task.nasq_child_ids.filtered(lambda child: child.active and child.has_access('read'))
        ],
        'attachment_count': attachments,
        'created_at': iso(task.create_date),
        'updated_at': iso(task.write_date),
        'allowed_actions': task.env['nasq.my.task.service']._allowed_actions(task),
    }


def dump_list_item(task):
    if task.nasq_personal:
        source, project, href = 'personal', None, f'/my-tasks/{task.id}'
    else:
        ref = task.env['nasq.task.links']._nasq_project_ref(task)
        if not ref:
            raise ValueError(f'task {task.id} is listed without a project ref')
        source, project, href = 'project', {'id': ref['id'], 'name': ref['name']}, ref['href']
    return {
        'id': task.id,
        'name': task.name,
        'state': list_state(task.state),
        'priority': list_priority(task.priority),
        'date_deadline': iso(task.date_deadline),
        'assignees': [_person(user) for user in task.user_ids],
        'source': source,
        'project': project,
        'href': href,
    }


def dump_comment(message):
    return {
        'id': message.id,
        'body': html2plaintext(message.body or '').strip(),
        'author': _person(message.author_id.user_ids[:1]) if message.author_id.user_ids else None,
        'created_at': iso(message.date),
    }
