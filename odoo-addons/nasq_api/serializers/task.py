# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields

from odoo.addons.nasq_api.controllers.common import ApiError

STATE_TO_API = {
    '01_in_progress': 'in_progress',
    '02_changes_requested': 'changes_requested',
    '03_approved': 'approved',
    '04_waiting_normal': 'waiting',
    '1_done': 'done',
    '1_canceled': 'cancelled',
}
API_TO_STATE = {v: k for k, v in STATE_TO_API.items()}

EMPLOYEE_FIELDS = {'name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids', 'personal_stage_type_id'}
MANAGER_FIELDS = EMPLOYEE_FIELDS | {'allocated_hours'}


def _days_remaining(task, today):
    if not task.date_deadline:
        return None
    return (task.date_deadline.date() - today).days


def _iso(dt):
    return fields.Datetime.to_string(dt).replace(' ', 'T') + 'Z' if dt else None


def _ref(record):
    return {'id': record.id, 'name': record.display_name}


def dump_task(task, today=None):
    today = today or date.today()
    days = _days_remaining(task, today)
    stage = task.personal_stage_type_id
    return {
        'id': task.id,
        'name': task.name,
        'project': _ref(task.project_id) if task.project_id else None,
        'state': STATE_TO_API[task.state],
        'priority': task.priority,
        'date_deadline': _iso(task.date_deadline),
        'days_remaining': days,
        'is_overdue': bool(days is not None and days < 0 and not task.is_closed),
        'is_closed': task.is_closed,
        'personal_stage': _ref(stage) if stage else None,
        'assignees': [_ref(u) for u in task.user_ids],
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in task.tag_ids],
    }


def dump_task_detail(task, today=None):
    today = today or date.today()
    data = dump_task(task, today)
    start = task.date_assign or task.create_date
    cycle = (task.date_end - start).days if task.is_closed and task.date_end and start else None
    data.update({
        'description_html': task.description or '',
        'allocated_hours': task.allocated_hours,
        'age_days': (today - task.create_date.date()).days,
        'cycle_days': cycle,
        'subtasks': [dump_task(t, today) for t in task.child_ids],
        'depends_on': [{'id': t.id, 'name': t.name, 'state': STATE_TO_API[t.state]} for t in task.depend_on_ids],
        'attachments': [{
            'id': a.id, 'name': a.name, 'mimetype': a.mimetype or '',
            'url': f'/web/content/{a.id}?download=true',
        } for a in task.attachment_ids],
        'can_approve': task._nasq_can_approve(),
        'created_at': _iso(task.create_date),
        'updated_at': _iso(task.write_date),
    })
    return data


def parse_task_vals(payload, can_manage):
    """Whitelist + coerce a PATCH payload into ORM vals. Raises ApiError(422)."""
    allowed = MANAGER_FIELDS if can_manage else EMPLOYEE_FIELDS
    vals = {}
    for key, value in payload.items():
        if key not in allowed:
            raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if key == 'date_deadline':
            vals[key] = fields.Datetime.to_datetime(value.replace('Z', '').replace('T', ' ')) if value else False
        elif key == 'priority':
            if value not in ('0', '1', '2', '3'):
                raise ApiError(422, 'invalid', "priority must be one of '0'..'3'", field=key)
            vals[key] = value
        elif key in ('user_ids', 'tag_ids'):
            if not isinstance(value, list) or not all(isinstance(i, int) for i in value):
                raise ApiError(422, 'invalid', f"{key} must be a list of ids", field=key)
            vals[key] = [(6, 0, value)]
        elif key == 'personal_stage_type_id':
            vals[key] = int(value) if value else False
        elif key == 'allocated_hours':
            vals[key] = float(value or 0)
        elif key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field=key)
            vals[key] = value.strip()
        else:
            vals[key] = value
    return vals
