# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import fields
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_api.serializers.common import iso

STATE_TO_API = {
    '01_in_progress': 'in_progress',
    '02_changes_requested': 'changes_requested',
    '03_approved': 'approved',
    '04_waiting_normal': 'waiting',
    '1_done': 'done',
    '1_canceled': 'cancelled',
}
API_TO_STATE = {v: k for k, v in STATE_TO_API.items()}

EMPLOYEE_FIELDS = {'name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids',
                   'personal_stage_type_id', 'stage_id'}
MANAGER_FIELDS = EMPLOYEE_FIELDS | {'allocated_hours'}


def _today(task, today=None):
    """The reader's calendar day.

    `date.today()` is the *server process*' day, so for any user whose timezone
    sits on the other side of midnight from the server every deadline count was
    off by one. Deadlines are UTC instants (see TaskDetails.vue's setDeadline);
    "today" is the requesting user's day.
    """
    return today or fields.Date.context_today(task)


def _days_remaining(task, today=None):
    if not task.date_deadline:
        return None
    return (task.date_deadline.date() - _today(task, today)).days


def _ref(record):
    return {'id': record.id, 'name': record.display_name}


def dump_task(task, today=None):
    today = _today(task, today)
    days = _days_remaining(task, today)
    stage = task.personal_stage_type_id
    return {
        'id': task.id,
        'name': task.name,
        'project': _ref(task.project_id) if task.project_id else None,
        'state': STATE_TO_API[task.state],
        'priority': task.priority,
        'date_deadline': iso(task.date_deadline),
        'days_remaining': days,
        'is_overdue': bool(days is not None and days < 0 and not task.is_closed),
        'is_closed': task.is_closed,
        'personal_stage': _ref(stage) if stage else None,
        # The *project* stage (kanban column on the project screen); personal_stage
        # is the user's private column on مهامي.
        'stage': _ref(task.stage_id) if task.stage_id else None,
        'assignees': [_ref(u) for u in task.user_ids],
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in task.tag_ids],
    }


def dump_task_detail(task, today=None):
    today = _today(task, today)
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
        'created_at': iso(task.create_date),
        'updated_at': iso(task.write_date),
    })
    return data


def _parse_deadline(value, key):
    """Coerce an ISO 8601 *UTC* deadline into a naive UTC datetime.

    Deadlines are UTC instants, so the only accepted shapes are `...Z` (what
    the client sends) and a bare `YYYY-MM-DD[ HH:MM:SS]`. An offset-bearing
    string ("2030-01-15T09:00:00+03:00") is rejected rather than silently
    truncated to the wrong instant. Every failure mode here — a non-string, a
    malformed string, an offset — used to escape `api_handler` as a raw
    ValueError/AttributeError and surface as a 500.
    """
    if not value:
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', "date_deadline must be an ISO 8601 UTC datetime string", field=key)
    text = value.strip().replace('T', ' ')
    if text.endswith('Z'):
        text = text[:-1]
    # Date.prototype.toISOString() always emits milliseconds; Odoo's
    # to_datetime does not accept them. Anything else left over (notably a
    # '+03:00' offset) still fails below, which is the point.
    text = re.sub(r'\.\d+$', '', text)
    try:
        return fields.Datetime.to_datetime(text)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "date_deadline must be an ISO 8601 UTC datetime string", field=key) from e


def _parse_personal_stage(value, key):
    """Coerce + authorise a personal stage id.

    `personal_stage_type_id`'s `domain="[('user_id','=',uid)]"` is a UI-only
    hint: nothing in the ORM stops a direct PATCH from pointing the field at
    another user's personal stage, so the ownership check has to live here.
    """
    if not value:
        return False
    try:
        stage_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "personal_stage_type_id must be a personal stage id", field=key) from e
    stage = request.env['project.task.type'].sudo().browse(stage_id).exists()
    if not stage or stage.user_id.id != request.env.uid:
        raise ApiError(422, 'invalid', "personal_stage_type_id must be one of your own personal stages", field=key)
    return stage.id


def _parse_stage(task, value, key):
    """Coerce + authorise a project stage id: it must be one of the task's project's stages."""
    try:
        stage_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key) from e
    stage = request.env['project.task.type'].browse(stage_id).exists()
    if not stage or task.project_id not in stage.project_ids:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key)
    return stage.id


def parse_task_vals(payload, can_manage, task):
    """Whitelist + coerce a PATCH payload for ``task`` into ORM vals. Raises ApiError(422)."""
    allowed = MANAGER_FIELDS if can_manage else EMPLOYEE_FIELDS
    vals = {}
    for key, value in payload.items():
        if key not in allowed:
            raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if key == 'date_deadline':
            vals[key] = _parse_deadline(value, key)
        elif key == 'priority':
            if value not in ('0', '1', '2', '3'):
                raise ApiError(422, 'invalid', "priority must be one of '0'..'3'", field=key)
            vals[key] = value
        elif key in ('user_ids', 'tag_ids'):
            if not isinstance(value, list) or not all(isinstance(i, int) for i in value):
                raise ApiError(422, 'invalid', f"{key} must be a list of ids", field=key)
            vals[key] = [(6, 0, value)]
        elif key == 'personal_stage_type_id':
            vals[key] = _parse_personal_stage(value, key)
        elif key == 'stage_id':
            vals[key] = _parse_stage(task, value, key)
        elif key == 'allocated_hours':
            # float() raises ValueError on 'x' and TypeError on a list/dict;
            # both must surface as the contract's 422 shape, not a 500.
            try:
                vals[key] = float(value or 0)
            except (TypeError, ValueError) as e:
                raise ApiError(422, 'invalid', "allocated_hours must be a number", field=key) from e
        elif key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field=key)
            vals[key] = value.strip()
        else:
            vals[key] = value
    return vals
