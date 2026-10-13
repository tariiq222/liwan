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
    task = task.with_env(task.env)
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
            for child in task.nasq_child_ids
        ],
        'attachment_count': attachments,
        'created_at': iso(task.create_date),
        'updated_at': iso(task.write_date),
        'allowed_actions': task.env['nasq.my.task.service']._allowed_actions(task),
    }


def dump_list_item(task):
    links = task.env['nasq.task.links']
    project = links._nasq_project_ref(task) if not task.nasq_personal else None
    return {
        'id': task.id,
        'name': task.name,
        'state': STATE_TO_WIRE[task.state],
        'priority': PRIORITY_TO_WIRE[task.priority or '0'],
        'date_deadline': iso(task.date_deadline),
        'assignees': [_person(user) for user in task.user_ids],
        'source': 'personal' if task.nasq_personal else 'project',
        'project': {'id': project['id'], 'name': project['name']} if project else None,
        'href': f'/my-tasks/{task.id}' if task.nasq_personal else (project or {}).get('href', ''),
    }


def dump_comment(message):
    return {
        'id': message.id,
        'body': html2plaintext(message.body or '').strip(),
        'author': _person(message.author_id.user_ids[:1]) if message.author_id.user_ids else None,
        'created_at': iso(message.date),
    }
