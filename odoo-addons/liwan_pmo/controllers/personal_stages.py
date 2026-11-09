# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_feature,
)


class PersonalStageController(http.Controller):

    @http.route('/api/v1/me/personal-stages', type='json2', auth='user', methods=['GET'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='read')
    def personal_stages(self):
        Stage = request.env['project.task.type']
        domain = [('user_id', '=', request.env.uid)]
        limit, offset = parse_page(request.httprequest.args)
        total = Stage.search_count(domain)
        if not total:
            service = request.env['liwan.entitlement.service']
            if not service._liwan_feature_write('pmo.enabled'):
                return {'items': [], 'total': 0}
            vals = request.env['project.task']._get_default_personal_stage_create_vals(request.env.uid)
            # `liwan_core.group_employee` implies `project.group_project_user`, whose ACL
            # owns create on `project.task.type`, so the caller's own environment is enough.
            Stage.with_context(default_project_ids=False).create(vals)
            total = Stage.search_count(domain)
        stages = Stage.search(domain, order='sequence, id', limit=limit, offset=offset)
        return {
            'items': [
                {'id': stage.id, 'name': stage.name, 'sequence': stage.sequence, 'fold': stage.fold}
                for stage in stages
            ],
            'total': total,
        }
