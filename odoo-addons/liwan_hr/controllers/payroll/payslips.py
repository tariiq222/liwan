# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from .runs import scoped_run
from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.assets.common import own_employee
from odoo.addons.liwan_hr.controllers.common import hr_rule_handler
from odoo.addons.liwan_hr.serializers.payroll.payslip import (
    dump_my_payslip_summary,
    dump_payslip,
)


def _my_payslips_domain():
    """The caller's own approved payslips; the record rules of the payslip model filter the same way."""
    employee = own_employee()
    if not employee:
        return [('id', '=', 0)]
    return [('employee_id', '=', employee.id), ('state', '=', 'done')]


class HrPayrollPayslipController(http.Controller):

    @http.route(
        '/api/v1/hr/payroll/runs/<int:run_id>/payslips/<int:payslip_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_payslip(self, run_id, payslip_id, **_):
        payslip = scoped_run(run_id).slip_ids.filtered(lambda slip: slip.id == payslip_id)
        if not payslip:
            raise MissingError(request.env._('hr.payslip %(id)s does not exist', id=payslip_id))
        return dump_payslip(payslip)

    @http.route('/api/v1/hr/payroll/payslips/mine', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.employees.read')
    def list_my_payslips(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        domain = _my_payslips_domain()
        Payslip = request.env['hr.payslip']
        payslips = Payslip.search(domain, order='date_from desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_my_payslip_summary(slip) for slip in payslips], 'total': Payslip.search_count(domain)}

    @http.route(
        '/api/v1/hr/payroll/payslips/mine/<int:payslip_id>',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.employees.read')
    def get_my_payslip(self, payslip_id, **_):
        payslip = request.env['hr.payslip'].search([*_my_payslips_domain(), ('id', '=', payslip_id)], limit=1)
        if not payslip:
            raise MissingError(request.env._('hr.payslip %(id)s does not exist', id=payslip_id))
        return dump_payslip(payslip)
