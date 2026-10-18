# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import datetime, time

import pytz

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.http import request
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_pmo.models.project_task import _validate_task_deliverables

STATE_TO_API = {
    '01_in_progress': 'in_progress',
    '02_changes_requested': 'changes_requested',
    '03_approved': 'approved',
    '04_waiting_normal': 'waiting',
    '1_done': 'done',
    '1_canceled': 'cancelled',
}
API_TO_STATE = {v: k for k, v in STATE_TO_API.items()}

EXCERPT_MAX = 140

EMPLOYEE_FIELDS = {'name', 'description', 'date_deadline', 'priority', 'user_ids', 'tag_ids',
                   'personal_stage_type_id', 'stage_id', 'milestone_id', 'deliverables'}
MANAGER_FIELDS = EMPLOYEE_FIELDS | {'allocated_hours'}


def _today(task, today=None):
    """The reader's calendar day.

    `date.today()` is the *server process*' day, so for any user whose timezone
    sits on the other side of midnight from the server every deadline count was
    off by one. Deadlines are UTC instants (see TaskDetails.vue's setDeadline);
    "today" is the requesting user's day.
    """
    return today or fields.Date.context_today(task)


def local_day_start_utc(task, day):
    """The start of calendar `day` in the reader's timezone, as a naive UTC datetime."""
    tz = task.env.tz  # the same zone `fields.Date.context_today` uses (context tz, else the user's)
    local_midnight = tz.localize(datetime.combine(day, time.min))
    return local_midnight.astimezone(pytz.utc).replace(tzinfo=None)


def today_start_utc(task):
    """The start of the reader's calendar day as a naive UTC datetime.

    `date_deadline < today_start_utc(...)` is the domain form of `_days_remaining < 0`:
    a deadline is overdue once its day, in the reader's timezone, is before today.
    """
    return local_day_start_utc(task, _today(task))


def description_excerpt(task):
    """One plain-text line of the task description, at most EXCERPT_MAX characters."""
    text = ' '.join(html2plaintext(task.description or '', include_references=False).split())
    return text if len(text) <= EXCERPT_MAX else text[:EXCERPT_MAX - 1].rstrip() + '…'


def _days_remaining(task, today=None):
    if not task.date_deadline:
        return None
    deadline_day = fields.Date.context_today(task, task.date_deadline)
    return (deadline_day - _today(task, today)).days


def _ref(record):
    return {'id': record.id, 'name': record.display_name}


def _project_ref(project):
    """{'id', 'name'} for a task's project, with the name resolved in sudo.

    The task itself was already access-checked before dump_task runs; an assignee
    of a task inside a privacy_visibility='followers' project they don't follow is
    still entitled to see that task (and its project's name) via the task's own
    visibility rule. Reading project.display_name in the caller's env instead hits
    project_public_members_rule and turns a legitimate 200 into a 403. Resolving the
    name in sudo here mirrors the Odoo web client, which resolves many2one display
    names in sudo — this is not an access dodge on project data in general, just on
    the name of a project whose task the caller can already read.
    """
    return {'id': project.id, 'name': project.sudo().display_name}


def _milestone_ref(milestone):
    """{'id', 'name'} for a task's milestone, with the name resolved in sudo.

    Same rationale as `_project_ref`: the task itself was already access-checked
    before dump_task_detail runs, and an assignee of a task inside a
    privacy_visibility='followers' project they don't follow is still entitled
    to see that task's milestone via the task's own visibility rule. Reading
    milestone.display_name in the caller's env instead hits
    milestone_visibility_rule and turns a legitimate 200 into a 403.
    """
    return {'id': milestone.id, 'name': milestone.sudo().display_name}


def task_counts(tasks):
    """{task_id: {'subtask_count', 'subtask_done_count', 'attachment_count'}} for `tasks`.

    A constant number of queries however many tasks are given. The counts follow the
    detail payload's own rules, in the caller's environment: subtasks are `child_ids`
    (so what the caller may not read is not counted), `subtask_done_count` is the
    subtasks that are done (a cancelled one is not), and attachments are those of
    `_webvue_task_attachments()` (direct binary files, never chatter files or links).
    """
    env = tasks.env
    counts = {t_id: {'subtask_count': 0, 'subtask_done_count': 0, 'attachment_count': 0} for t_id in tasks.ids}
    child_groups = env['project.task']._read_group(
        [('parent_id', 'in', tasks.ids), ('recurring_task', '=', False),
         '|', ('parent_id.is_template', '=', True), ('is_template', '=', False)],
        ['parent_id', 'state'], ['__count'],
    )
    for parent, state, count in child_groups:
        counts[parent.id]['subtask_count'] += count
        if state == API_TO_STATE['done']:
            counts[parent.id]['subtask_done_count'] += count
    candidates = env['ir.attachment'].search_fetch(
        [('res_model', '=', 'project.task'), ('res_id', 'in', tasks.ids),
         ('type', '=', 'binary'), ('url', '=', False)],
        ['res_id'],
    )
    by_task = {}
    for attachment in candidates:
        by_task.setdefault(attachment.res_id, set()).add(attachment.id)
    # Chatter files are excluded exactly as `_webvue_task_attachments` does; only tasks that
    # have a candidate file need their messages, and the loop shares one prefetch.
    for task in tasks.browse(by_task):
        counts[task.id]['attachment_count'] = len(by_task[task.id] - set(task.message_ids.attachment_ids.ids))
    return counts


def dump_task(task, today=None, counts=None):
    """The list shape of one task. `counts` is a `task_counts` map covering `task`;
    list callers pass it for the whole page, a single dump computes its own."""
    today = _today(task, today)
    days = _days_remaining(task, today)
    stage = task.personal_stage_type_id
    return {
        'id': task.id,
        'name': task.name,
        'project': _project_ref(task.project_id) if task.project_id else None,
        'description_excerpt': description_excerpt(task),
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
        'can_write': task._webvue_can_write(),
        'can_approve': task._webvue_can_approve(),
        'allowed_transitions': task._webvue_allowed_transitions(),
        **(counts or task_counts(task))[task.id],
    }


def dump_task_detail(task, today=None):
    today = _today(task, today)
    counts = task_counts(task | task.child_ids)
    data = dump_task(task, today, counts)
    start = task.date_assign or task.create_date
    cycle = (task.date_end - start).days if task.is_closed and task.date_end and start else None
    dependencies = task.env['project.task'].search([
        ('id', 'in', task.depend_on_ids.ids),
        ('company_id', '=', task.env.company.id),
        ('project_id', '=', task.project_id.id),
        ('project_id.active', '=', True),
        ('project_id.company_id', '=', task.env.company.id),
    ])
    data.update({
        'description_html': task.description or '',
        'deliverables': task.webvue_deliverables or [],
        'allocated_hours': task.allocated_hours,
        'age_days': (today - task.create_date.date()).days,
        'cycle_days': cycle,
        'subtasks': [dump_task(t, today, counts) for t in task.child_ids],
        'depends_on': [{'id': t.id, 'name': t.name, 'state': STATE_TO_API[t.state]} for t in dependencies],
        'attachments': [{
            'id': a.id, 'name': a.name, 'mimetype': a.mimetype or '',
            'url': f'/web/content/{a.id}?download=true',
        } for a in task._webvue_task_attachments()],
        'allowed_actions': [
            'read',
            *(['write'] if task._webvue_can_write() else []),
            *(['archive'] if task._webvue_can_archive() else []),
            *(['approve'] if task._webvue_can_approve() else []),
            *(['request_completion'] if task._webvue_can_request_completion() else []),
            *(['accept_completion', 'return_completion'] if task._webvue_can_decide_completion() else []),
            *(['withdraw_completion'] if task._webvue_can_withdraw_completion() else []),
        ],
        'can_manage_dependencies': bool(task._webvue_can_manage_dependencies()),
        'created_at': iso(task.create_date),
        'updated_at': iso(task.write_date),
        'planned_start': fields.Date.to_string(task.webvue_planned_start) if task.webvue_planned_start else None,
        'milestone': _milestone_ref(task.milestone_id) if task.milestone_id else None,
        'completion_pending': bool(task.webvue_completion_pending),
        'completion_revision': task.webvue_completion_revision or 0,
        'completion_return_note': task.webvue_completion_return_note or None,
        'completion_policy': task.project_id.webvue_completion_approval if task.project_id else 'none',
        'completion_approver': _ref(task._webvue_completion_reviewer()) if task._webvue_completion_reviewer() else None,
        'completion_blocked_reason': task._webvue_completion_blocked_reason(),
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
    """Coerce + authorise a project stage id: it must be one of the task's project's stages.

    Browsed in sudo, mirroring `_parse_personal_stage`: a foreign *personal* stage id
    (user_id set, no project_ids) passes `exists()` (raw SQL, ignores ir.rule) but then
    reading `stage.project_ids` in the caller's own env hits `task_type_visibility_rule`
    and raises AccessError instead of the contracted 422 — an existence oracle to boot.
    The `task.project_id in stage.project_ids` membership test is the real authorization
    here; `task` was already access-checked before parse_task_vals runs.
    """
    try:
        stage_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key) from e
    stage = request.env['project.task.type'].sudo().browse(stage_id).exists()
    if not stage or task.project_id not in stage.project_ids:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stage ids", field=key)
    return stage.id


def _parse_milestone(task, value, key):
    """Coerce + authorise a milestone id: it must belong to the task's own project.

    Browsed in sudo, mirroring `_parse_stage`: a milestone belonging to another,
    unreadable project (e.g. `privacy_visibility='followers'`) passes `exists()`
    (raw SQL, ignores ir.rule) but then reading `milestone.project_id` in the
    caller's own env hits `milestone_visibility_rule` and raises AccessError
    instead of the contracted 422 — an existence oracle to boot. The
    `milestone.project_id != task.project_id` membership test is the real
    authorization here; `task` was already access-checked before parse_task_vals runs.
    """
    if value is None or value is False:
        return False
    try:
        milestone_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(422, 'invalid', "milestone_id must be one of the project's milestones", field=key) from e
    milestone = request.env['project.milestone'].sudo().browse(milestone_id).exists()
    if not milestone or milestone.project_id != task.project_id:
        raise ApiError(422, 'invalid', "milestone_id must be one of the project's milestones", field=key)
    return milestone.id


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
        elif key == 'user_ids':
            if not isinstance(value, list) or not all(isinstance(i, int) for i in value):
                raise ApiError(422, 'invalid', f"{key} must be a list of ids", field=key)
            vals[key] = [(6, 0, value)]
        elif key == 'tag_ids':
            if not isinstance(value, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in value):
                raise ApiError(422, 'invalid', "tag_ids must be a list of ids", field=key)
            tags = request.env['project.tags'].browse(value).exists()
            if len(tags) != len(set(value)):
                raise ApiError(422, 'invalid', "unknown tag id", field=key)
            vals[key] = [(6, 0, tags.ids)]
        elif key == 'personal_stage_type_id':
            vals[key] = _parse_personal_stage(value, key)
        elif key == 'stage_id':
            vals[key] = _parse_stage(task, value, key)
        elif key == 'milestone_id':
            vals[key] = _parse_milestone(task, value, key)
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
        elif key == 'description':
            if not isinstance(value, str):
                raise ApiError(422, 'invalid', "description must be a string", field=key)
            vals[key] = value
        elif key == 'deliverables':
            if not isinstance(value, list):
                raise ApiError(422, 'invalid', "deliverables must be a list", field=key)
            try:
                vals['webvue_deliverables'] = _validate_task_deliverables(value, request.env)
            except ValidationError as error:
                raise ApiError(422, 'invalid', str(error), field=key) from error
        else:
            vals[key] = value
    return vals
