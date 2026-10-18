# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.hr_report import dump_expiring, parse_within_days


def _can(capability):
    return request.env['webvue.access.service']._webvue_has_capability(request.env.user, capability)


def _require(capability):
    if not _can(capability):
        raise ApiError(403, 'forbidden', f'{capability} capability is required')


class HrReportController(http.Controller):

    @http.route('/api/v1/hr/expiring', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def list_expiring(self, **_):
        _require('hr.employees.manage')
        within_days = parse_within_days(request.httprequest.args.get('within_days'))
        items = request.env['webvue.hr.report']._webvue_expiring(
            within_days, documents=_can('hr.documents.read'),
        )
        return dump_expiring(items)

    @http.route('/api/v1/hr/saudization', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    def get_saudization(self, **_):
        _require('hr.employees.manage')
        return request.env['webvue.hr.report']._webvue_saudization()
