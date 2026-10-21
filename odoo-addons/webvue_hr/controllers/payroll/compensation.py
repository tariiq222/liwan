# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import payroll_employee
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.serializers.payroll.compensation import (
    dump_compensation,
    parse_compensation,
)


class HrPayrollCompensationController(http.Controller):

    @http.route(
        '/api/v1/hr/payroll/compensation/<int:employee_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_compensation(self, employee_id, **_):
        employee = payroll_employee(employee_id)
        record = request.env['webvue.hr.compensation'].search([('employee_id', '=', employee.id)], limit=1)
        if not record:
            raise ApiError(404, 'not_found', 'the employee has no compensation record')
        return dump_compensation(record)

    @http.route(
        '/api/v1/hr/payroll/compensation/<int:employee_id>',
        type='json2', auth='user', methods=['PUT'], readonly=False,
    )
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def put_compensation(self, employee_id, **payload):
        employee = payroll_employee(employee_id)
        vals = parse_compensation(payload)
        if vals['bank_id'] and not request.env['res.bank'].search_count([('id', '=', vals['bank_id'])]):
            raise ApiError(422, 'invalid', 'bank_id does not reference a bank', field='bank_id')
        record = request.env['webvue.hr.compensation'].search([('employee_id', '=', employee.id)], limit=1)
        if record:
            record.write(vals)
        else:
            record = request.env['webvue.hr.compensation'].create({**vals, 'employee_id': employee.id})
        return dump_compensation(record)
