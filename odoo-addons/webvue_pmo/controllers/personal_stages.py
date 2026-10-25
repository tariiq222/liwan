# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature


class PersonalStageController(http.Controller):

    @http.route('/api/v1/me/personal-stages', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def personal_stages(self):
        Stage = request.env['project.task.type']
        stages = Stage.search([('user_id', '=', request.env.uid)], order='sequence, id')
        if not stages:
            service = request.env['webvue.entitlement.service']
            if not service._webvue_feature_write('pmo.enabled'):
                return []
            vals = request.env['project.task']._get_default_personal_stage_create_vals(request.env.uid)
            # `webvue_core.group_employee` implies `project.group_project_user`, whose ACL
            # owns create on `project.task.type`, so the caller's own environment is enough.
            stages = Stage.with_context(default_project_ids=False).create(vals)
        return [{'id': s.id, 'name': s.name, 'sequence': s.sequence, 'fold': s.fold} for s in stages]
