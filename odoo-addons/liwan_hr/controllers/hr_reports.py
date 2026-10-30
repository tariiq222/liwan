# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    require_capabilities,
    requires_feature,
)
from odoo.addons.liwan_hr.serializers.hr_report import dump_expiring, parse_within_days


def _can(capability):
    return request.env['liwan.access.service']._liwan_has_capability(request.env.user, capability)


def _require(capability):
    require_capabilities(capability)


class HrReportController(http.Controller):

    @http.route('/api/v1/hr/expiring', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_expiring(self, **_):
        _require('hr.employees.manage')
        within_days = parse_within_days(request.httprequest.args.get('within_days'))
        items = request.env['liwan.hr.report']._liwan_expiring(
            within_days,
        )
        return dump_expiring(items)

    @http.route('/api/v1/hr/saudization', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_saudization(self, **_):
        _require('hr.employees.manage')
        return request.env['liwan.hr.report']._liwan_saudization()
