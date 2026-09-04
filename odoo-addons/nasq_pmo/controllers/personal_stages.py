# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.nasq_api.controllers.common import api_handler


class PersonalStageController(http.Controller):

    @http.route('/api/v1/me/personal-stages', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    def personal_stages(self):
        Stage = request.env['project.task.type']
        stages = Stage.search([('user_id', '=', request.env.uid)], order='sequence, id')
        if not stages:
            vals = request.env['project.task']._get_default_personal_stage_create_vals(request.env.uid)
            stages = Stage.sudo().with_context(default_project_ids=False).create(vals).with_user(request.env.uid)
        return [{'id': s.id, 'name': s.name, 'sequence': s.sequence, 'fold': s.fold} for s in stages]
