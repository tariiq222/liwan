# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)


class CrmDashboardController(http.Controller):

    @http.route('/api/v1/crm/dashboard', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def dashboard(self, **_):
        return request.env['webvue.crm.dashboard']._webvue_dashboard(request.env.user)
