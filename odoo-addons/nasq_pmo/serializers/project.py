# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_pmo.models.project_project import VISIBILITY_VALUES
from odoo.addons.nasq_pmo.serializers.dates import parse_date

STATUS_TO_API = {'on_track': 'on_track', 'at_risk': 'at_risk', 'off_track': 'off_track', 'on_hold': 'on_hold', 'done': 'done', 'to_define': None}
# Odoo's 'portal' (its default) means "all internal users" for nasq: there are no portal users.
VISIBILITY_TO_API = {'followers': 'followers', 'employees': 'employees', 'portal': 'employees', 'invited_users': 'followers'}
PROJECT_FIELDS = {'name', 'description', 'user_id', 'privacy_visibility', 'date_start', 'date', 'tag_ids'}


def _user_ref(user):
    return {'id': user.id, 'name': user.name} if user else None


def dump_stage(project, stage):
    return {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold,
            'task_count': project._nasq_stage_task_count(stage)}


def dump_project(project):
    return {
        'id': project.id,
        'name': project.name,
        'status': STATUS_TO_API.get(project.last_update_status),
        'progress': round(project.task_completion_percentage * 100),
        'task_count': project.task_count,
        'closed_task_count': project.closed_task_count,
        'active': project.active,
        'can_manage': project._nasq_can_manage(),
    }


def dump_project_detail(project):
    data = dump_project(project)
    data.update({
        'stages': [dump_stage(project, s) for s in project.type_ids.sorted(lambda s: (s.sequence, s.id))],
        'description_html': project.description or '',
        'manager': _user_ref(project.user_id),
        'privacy_visibility': VISIBILITY_TO_API.get(project.privacy_visibility, 'employees'),
        'date_start': fields.Date.to_string(project.date_start) if project.date_start else None,
        'date_end': fields.Date.to_string(project.date) if project.date else None,
        'tags': [{'id': t.id, 'name': t.name, 'color': t.color} for t in project.tag_ids],
        'followers_count': len(project._nasq_followers()),
        'milestone_count': len(project.milestone_ids),
    })
    return data


def parse_project_vals(payload):
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
                if not user or user.share or not user.active:
                    raise ApiError(422, 'invalid', "user_id must be an active internal user", field=key)
                vals[key] = user.id
        elif key == 'privacy_visibility':
            if value not in VISIBILITY_VALUES:
                raise ApiError(422, 'invalid', "privacy_visibility must be 'employees' or 'followers'", field=key)
            vals[key] = value
        elif key in ('date_start', 'date'):
            vals[key] = parse_date(value, key)
        elif key == 'tag_ids':
            if not isinstance(value, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in value):
                raise ApiError(422, 'invalid', "tag_ids must be a list of ids", field=key)
            tags = request.env['project.tags'].browse(value).exists()
            if len(tags) != len(set(value)):
                message = "unknown tag id"
                raise ApiError(422, 'invalid', message, field=key)
            vals[key] = [(6, 0, tags.ids)]
    return vals
