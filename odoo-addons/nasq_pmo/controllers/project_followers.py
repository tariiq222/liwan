# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    requires_feature,
)
from odoo.addons.nasq_pmo.models.project_project import NasqCharterState


def _dump_users(users):
    return [{'id': u.id, 'name': u.name} for u in users.sorted('name')]


def _user(value):
    is_int = isinstance(value, int) and not isinstance(value, bool)
    user = request.env['res.users'].browse(int(value)).exists() if is_int else None
    if not user or user.share or not user.active:
        raise ApiError(422, 'invalid', "user_id must be an active internal user", field='user_id')
    return user


class ProjectFollowerController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/followers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def list_followers(self, project_id):
        return _dump_users(get_record('project.project', project_id)._nasq_followers())

    @http.route('/api/v1/projects/<int:project_id>/followers', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def add_follower(self, project_id, user_id=None, **_):
        project = get_record('project.project', project_id)
        return _dump_users(project._nasq_add_follower(_user(user_id)))

    @http.route('/api/v1/projects/<int:project_id>/followers/<int:user_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def remove_follower(self, project_id, user_id, **_):
        project = get_record('project.project', project_id)
        try:
            return _dump_users(project._nasq_remove_follower(_user(user_id)))
        except NasqCharterState as e:
            raise ApiError(409, 'charter_state', str(e)) from e
