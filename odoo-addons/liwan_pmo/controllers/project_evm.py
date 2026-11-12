# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .project_baselines import active_project
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    declare_read_capability_scope,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_pmo.serializers.project_evm import build_evm

FEATURES = ('pmo.enabled', 'pmo.evm')


class ProjectEvmController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/evm', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    def get_evm(self, project_id):
        # Cost is exposed, so the gate is the one of GET /projects/{id}/finance: a visible project whose finance the caller may read.
        require_capabilities('pmo.projects.read')
        declare_read_capability_scope('pmo.projects.read')
        project = active_project(project_id)
        project._liwan_check_tool('planning')
        project._liwan_check_tool('finance')
        project._liwan_check_finance_read()
        baseline = request.env['liwan.project.baseline'].search([('project_id', '=', project.id)], order='number desc', limit=1)
        if not baseline:
            raise ApiError(409, 'no_baseline', "take a baseline before reading earned value")
        return build_evm(project, baseline)
