# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_pmo.models.project_project import VISIBILITY_VALUES
from odoo.addons.nasq_pmo.serializers.dates import parse_date
from odoo.addons.nasq_pmo.serializers.project_charter import (
    dump_charter,
    parse_charter_vals,
)

STATUS_TO_API = {'on_track': 'on_track', 'at_risk': 'at_risk', 'off_track': 'off_track', 'on_hold': 'on_hold', 'done': 'done', 'to_define': None}
# Odoo's 'portal' (its default) means "all internal users" for nasq: there are no portal users.
VISIBILITY_TO_API = {'followers': 'followers', 'employees': 'employees', 'portal': 'employees', 'invited_users': 'followers'}
PROJECT_FIELDS = {
    'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date', 'tag_ids',
    'allow_task_dependencies', 'nasq_completion_approval', 'nasq_completion_approver_id',
}
CREATE_FIELDS = {
    'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date',
    'date_end', 'tag_ids', 'allow_task_dependencies', 'charter',
}
COMPLETION_APPROVAL_VALUES = ('none', 'project_manager', 'specific_user')
_ABSENT = object()


def _user_ref(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_stage(project, stage):
    return {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold,
            'task_count': project._nasq_stage_task_count(stage)}


def dump_project_task_summary(project):
    # Project readers need not be task readers (for example a charter sponsor).
    # Counts describe caller-visible tasks; do not query a denied task model.
    if not project.env['project.task'].has_access('read'):
        return {'progress': 0, 'task_count': 0, 'closed_task_count': 0}
    return {
        'progress': round(project.task_completion_percentage * 100),
        'task_count': project.task_count,
        'closed_task_count': project.closed_task_count,
    }


def parse_write_token(value):
    if not isinstance(value, str) or not value.startswith('v') or not value[1:].isdigit():
        raise ApiError(422, 'invalid', "expected_updated_at is not a valid write token", field='expected_updated_at')
    return value


def dump_project(project):
    can_manage = project._nasq_can_manage()
    return {
        'id': project.id,
        'name': project.name,
        'manager': _user_ref(project.user_id),
        'date_end': fields.Date.to_string(project.date) if project.date else None,
        'status': STATUS_TO_API.get(project.last_update_status),
        **dump_project_task_summary(project),
        'active': project.active,
        'charter_state': project.nasq_charter_state or 'draft',
        'phase': project.nasq_phase,
        'can_manage': can_manage,
        'allowed_actions': ['read', *(['write', 'archive'] if can_manage else [])],
    }


def dump_project_detail(project):
    data = dump_project(project)
    data.update({
        'stages': [dump_stage(project, s) for s in project.type_ids.sorted(lambda s: (s.sequence, s.id))],
        'description_html': project.description or '',
        'privacy_visibility': VISIBILITY_TO_API.get(project.privacy_visibility, 'employees'),
        'date_start': fields.Date.to_string(project.date_start) if project.date_start else None,
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in project.tag_ids],
        'followers_count': len(project._nasq_followers()),
        'milestone_count': len(project.milestone_ids),
        'allow_task_dependencies': bool(project.allow_task_dependencies),
        'completion_approval': project.nasq_completion_approval or 'none',
        'completion_approver': _user_ref(project.nasq_completion_approver_id),
        'updated_at': project._nasq_updated_at(),
        'charter': dump_charter(project),
        'phase_state': project._nasq_phase_state(),
    })
    return data


def parse_project_vals(payload, project=None):
    vals = {}
    for key, value in payload.items():
        if key not in PROJECT_FIELDS:
            raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if key == 'name':
            if not isinstance(value, str) or not value.strip():
                raise ApiError(422, 'invalid', "name must not be empty", field=key)
            vals[key] = value.strip()
        elif key == 'description':
            if value is not None and not isinstance(value, str):
                raise ApiError(422, 'invalid', "description must be a string", field=key)
            vals[key] = value or ''
        elif key == 'user_id':
            if value is None:
                vals[key] = False
            else:
                is_int = isinstance(value, int) and not isinstance(value, bool)
                user = request.env['res.users'].browse(int(value)).exists() if is_int else None
                current_id = project.user_id.id if project and project.user_id else None
                if not user or not request.env['project.project']._nasq_eligible_user(user, current_id=current_id):
                    raise ApiError(422, 'invalid', "user_id must be an active internal user in the current company", field=key)
                vals[key] = user.id
        elif key == 'privacy_visibility':
            if value not in VISIBILITY_VALUES:
                raise ApiError(422, 'invalid', "privacy_visibility must be 'employees' or 'followers'", field=key)
            vals[key] = value
        elif key in ('date_start', 'date'):
            vals[key] = parse_date(value, key)
        elif key == 'allow_task_dependencies':
            if not isinstance(value, bool):
                raise ApiError(422, 'invalid', "allow_task_dependencies must be a boolean", field=key)
            vals[key] = value
        elif key == 'tag_ids':
            if not isinstance(value, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in value):
                raise ApiError(422, 'invalid', "tag_ids must be a list of ids", field=key)
            tags = request.env['project.tags'].browse(value).exists()
            if len(tags) != len(set(value)):
                message = "unknown tag id"
                raise ApiError(422, 'invalid', message, field=key)
            vals[key] = [(6, 0, tags.ids)]
        elif key == 'nasq_completion_approval':
            if value not in COMPLETION_APPROVAL_VALUES:
                raise ApiError(422, 'invalid', "nasq_completion_approval must be none, project_manager or specific_user", field=key)
            vals[key] = value
        elif key == 'nasq_completion_approver_id':
            if value in (None, False):
                vals[key] = False
            else:
                is_int = isinstance(value, int) and not isinstance(value, bool)
                user = request.env['res.users'].browse(int(value)).exists() if is_int else None
                if not user or user.share or not user.active:
                    raise ApiError(422, 'invalid', "nasq_completion_approver_id must be an active internal user", field=key)
                vals[key] = user.id
    _reject_inverted_dates(vals)
    return vals


def _reject_inverted_dates(vals):
    if 'date_start' not in vals or 'date' not in vals:
        return
    start, end = vals['date_start'], vals['date']
    if start and end and start > end:
        raise ApiError(422, 'invalid', "date_start must be on or before date", field='date_start')


def parse_project_create(payload):
    payload = dict(payload)
    unknown = set(payload) - CREATE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    name = payload.pop('name', None)
    if not isinstance(name, str) or not name.strip():
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    charter = payload.pop('charter', _ABSENT)
    date_end = _ABSENT
    if 'date_end' in payload:
        if 'date' in payload:
            raise ApiError(422, 'invalid', "date and date_end cannot both be provided", field='date_end')
        date_end = payload.pop('date_end')
    vals = parse_project_vals(payload) if payload else {}
    if date_end is not _ABSENT:
        vals['date'] = parse_date(date_end, 'date_end')
        _reject_inverted_dates(vals)
    if charter is not _ABSENT:
        vals.update(parse_charter_vals(charter))
    settings = request.env['nasq.pmo.settings'].get()
    manager_id = vals.get('user_id', request.env.uid)
    if settings['require_manager_on_create'] and not manager_id:
        raise ApiError(422, 'invalid', "manager is required to create a project", field='user_id')
    if settings['require_end_date_on_create'] and not vals.get('date'):
        raise ApiError(422, 'invalid', "end date is required to create a project", field='date_end')
    return name.strip(), vals


def parse_project_copy(payload):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - {'name', 'start_date'}
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    name = payload.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
        raise ApiError(422, 'invalid', "name must be a non-empty string of at most 255 characters", field='name')
    start_date = payload.get('start_date')
    if not isinstance(start_date, str):
        raise ApiError(422, 'invalid', "start_date must be a YYYY-MM-DD date", field='start_date')
    try:
        parsed = date.fromisoformat(start_date)
    except ValueError as error:
        raise ApiError(422, 'invalid', "start_date must be a YYYY-MM-DD date", field='start_date') from error
    if parsed.isoformat() != start_date:
        raise ApiError(422, 'invalid', "start_date must be a YYYY-MM-DD date", field='start_date')
    return name.strip(), parsed
