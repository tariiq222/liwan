# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from .records import get_visible_record
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_pmo.serializers.project import dump_stage


def _stage_of(project, stage_id):
    stage = request.env['project.task.type'].browse(int(stage_id)).exists()
    if not stage or stage not in project.type_ids:
        raise ApiError(422, 'invalid', "stage_id must be one of the project's stages", field='stage_id')
    return stage


def _parse_stage_body(name=None, fold=None, require_name=True):
    vals = {}
    if name is not None or require_name:
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', "name must not be empty", field='name')
        vals['name'] = name.strip()
    if fold is not None:
        if not isinstance(fold, bool):
            raise ApiError(422, 'invalid', "fold must be a boolean", field='fold')
        vals['fold'] = fold
    return vals


class ProjectStageController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/stages', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def add_stage(self, project_id, name=None, fold=None, **_):
        project = get_visible_record('project.project', project_id)
        vals = _parse_stage_body(name, fold)
        stage = project._liwan_add_stage(vals['name'], vals.get('fold', False))
        return request.make_json_response(dump_stage(project, stage), status=201)

    @http.route('/api/v1/projects/<int:project_id>/stages/<int:stage_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def patch_stage(self, project_id, stage_id, name=None, fold=None, **_):
        project = get_visible_record('project.project', project_id)
        stage = _stage_of(project, stage_id)
        vals = _parse_stage_body(name, fold, require_name=False)
        if not vals:
            raise ApiError(422, 'invalid', "no fields to update")
        return dump_stage(project, project._liwan_update_stage(stage, vals))

    @http.route('/api/v1/projects/<int:project_id>/stages/order', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def reorder_stages(self, project_id, ids=None, **_):
        project = get_visible_record('project.project', project_id)
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise ApiError(422, 'invalid', "ids must be a list of stage ids", field='ids')
        try:
            stages = project._liwan_reorder_stages(ids)
        except ValueError as e:
            raise ApiError(422, 'invalid', str(e), field='ids') from e
        return [dump_stage(project, s) for s in stages]

    @http.route('/api/v1/projects/<int:project_id>/stages/<int:stage_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def delete_stage(self, project_id, stage_id, **_):
        project = get_visible_record('project.project', project_id)
        stage = _stage_of(project, stage_id)
        try:
            project._liwan_delete_stage(stage)
        except UserError as e:
            count = getattr(e, 'liwan_count', None)
            if count is None:
                raise
            raise ApiError(422, 'stage_not_empty', f"This stage still holds {count} task(s).") from e
        return request.make_json_response('', status=204)
