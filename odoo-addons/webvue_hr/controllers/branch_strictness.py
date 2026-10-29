# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.access_admin import require_exact
from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)


class HrBranchStrictnessController(http.Controller):
    """«Stricter than the general policy» for HR and payroll: their roles are never inherited into branches."""

    @http.route('/api/v1/hr/branch-strictness', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', operation='read')
    @requires_capability('hr.employees.manage')
    def get_hr_strictness(self, **_):
        return request.env['webvue.access.service']._webvue_branch_strict_state('hr')

    @http.route('/api/v1/hr/branch-strictness', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', operation='write')
    @requires_capability('hr.employees.manage')
    def patch_hr_strictness(self, **payload):
        require_exact(payload, {'enabled'}, {'enabled'})
        return request.env['webvue.access.service']._webvue_set_branch_strict('hr', payload['enabled'])

    @http.route('/api/v1/hr/payroll/branch-strictness', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_payroll_strictness(self, **_):
        return request.env['webvue.access.service']._webvue_branch_strict_state('payroll')

    @http.route('/api/v1/hr/payroll/branch-strictness', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def patch_payroll_strictness(self, **payload):
        require_exact(payload, {'enabled'}, {'enabled'})
        return request.env['webvue.access.service']._webvue_set_branch_strict('payroll', payload['enabled'])
