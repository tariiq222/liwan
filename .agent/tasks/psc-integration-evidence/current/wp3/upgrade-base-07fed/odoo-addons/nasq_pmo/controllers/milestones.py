# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import ApiError, api_handler, get_record
from odoo.addons.nasq_pmo.serializers.dates import parse_date
from odoo.addons.nasq_pmo.serializers.milestone import dump_milestone


def _milestone_of(project, mid):
    """Coerce + authorise a milestone id: it must belong to `project`.

    Browsed in sudo, mirroring `serializers/task.py::_parse_milestone`: a milestone
    belonging to another, unreadable project (e.g. `privacy_visibility='followers'`)
    passes `exists()` (raw SQL, ignores ir.rule) but then reading `milestone.project_id`
    in the caller's own env hits `milestone_visibility_rule` and raises AccessError
    instead of the contracted 422 — an existence oracle to boot. The
    `milestone.project_id.id != project.id` membership test is the real authorization
    here; `project` was already access-checked by `get_record`.
    """
    m = request.env['project.milestone'].sudo().browse(int(mid)).exists()
    if not m or m.project_id.id != project.id:
        raise ApiError(422, 'invalid', "milestone must belong to this project", field='milestone_id')
    return m


def _sorted(milestones):
    return milestones.sorted(lambda m: (m.deadline is False, m.deadline or '', m.id))


class MilestoneController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/milestones', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    def list_milestones(self, project_id):
        project = get_record('project.project', project_id)
        return [dump_milestone(project, m) for m in _sorted(project.milestone_ids)]

    @http.route('/api/v1/projects/<int:project_id>/milestones', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    def create_milestone(self, project_id, name=None, deadline=None, **_):
        project = get_record('project.project', project_id)
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        day = parse_date(deadline, 'deadline')
        m = project._nasq_create_milestone(name.strip(), deadline=day or None)
        return request.make_json_response(dump_milestone(project, m), status=201)

    @http.route('/api/v1/projects/<int:project_id>/milestones/<int:mid>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    def patch_milestone(self, project_id, mid, **payload):
        payload.pop('project_id', None)
        payload.pop('mid', None)
        project = get_record('project.project', project_id)
        m = _milestone_of(project, mid)
        vals = {}
        for key, value in payload.items():
            if key == 'name':
                if not isinstance(value, str) or not value.strip():
                    raise ApiError(422, 'invalid', "name must not be empty", field=key)
                vals[key] = value.strip()
            elif key == 'deadline':
                vals[key] = parse_date(value, key)
            elif key == 'is_reached':
                if not isinstance(value, bool):
                    raise ApiError(422, 'invalid', "is_reached must be a boolean", field=key)
                vals[key] = value
            else:
                raise ApiError(422, 'unknown_field', f"field {key!r} is not writable", field=key)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        return dump_milestone(project, project._nasq_update_milestone(m, vals))

    @http.route('/api/v1/projects/<int:project_id>/milestones/<int:mid>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    def delete_milestone(self, project_id, mid, **_):
        project = get_record('project.project', project_id)
        m = _milestone_of(project, mid)
        try:
            project._nasq_delete_milestone(m)
        except UserError as e:
            count = getattr(e, 'nasq_count', None)
            if count is None:
                raise
            raise ApiError(422, 'milestone_has_tasks', f"{count} task(s) are linked to this milestone.") from e
        return request.make_json_response('', status=204)
