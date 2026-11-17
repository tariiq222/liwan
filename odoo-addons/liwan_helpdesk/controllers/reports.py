# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk/reports``: the numbers of the desk for one period."""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)


class HelpdeskReportsController(http.Controller):

    @http.route('/api/v1/helpdesk/reports', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', 'helpdesk.reports', operation='read')
    @requires_capability('helpdesk.reports.read')
    def reports(self, **_):
        period_value = request.httprequest.args.get('period', '30')
        model = request.env['liwan.helpdesk.reports']
        return model._liwan_report(model._liwan_period(period_value))
