# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import current_company, payroll_employee
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.controllers.common import hr_rule_handler, unique_conflict
from odoo.addons.webvue_hr.serializers.payroll.eos import (
    dump_case_item,
    dump_estimate,
    dump_settlement,
    parse_case_map,
    parse_estimate_args,
    parse_settlement,
)
from odoo.addons.webvue_hr.serializers.payroll.revision import (
    require_revision,
    split_revision,
)

EOS_ROUTE = '/api/v1/hr/payroll/eos'
CASE_CONFLICT = 'the end-of-service case of this reason changed; reload before saving'


def _settlement(employee, *, shown=False):
    Settlement = request.env['webvue.hr.payroll.eos.settlement']
    settlement = Settlement._webvue_shown(employee) if shown else Settlement._webvue_current(employee)
    if not settlement:
        raise ApiError(404, 'not_found', 'the employee has no final settlement')
    return settlement


def _case_item(reason):
    Case = request.env['webvue.hr.payroll.eos.case']
    company = current_company()
    return dump_case_item(reason, Case._webvue_case_for(reason, company), Case._webvue_company_row(reason, company))


class HrPayrollEosController(http.Controller):

    @http.route(f'{EOS_ROUTE}/<int:employee_id>/estimate', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def estimate(self, employee_id, **_):
        employee = payroll_employee(employee_id)
        day, case = parse_estimate_args(request.httprequest.args)
        day = day or employee.departure_date
        if not day:
            raise ApiError(422, 'invalid', 'date is required: the employee has no departure date', field='date')
        Settlement = request.env['webvue.hr.payroll.eos.settlement']
        return dump_estimate(employee, Settlement._webvue_estimate(employee, day, Settlement._webvue_resolve_case(employee, case)))

    @http.route(f'{EOS_ROUTE}/<int:employee_id>/settlement', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_settlement(self, employee_id, **_):
        return dump_settlement(_settlement(payroll_employee(employee_id), shown=True))

    @http.route(f'{EOS_ROUTE}/<int:employee_id>/settlement', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def put_settlement(self, employee_id, **payload):
        employee = payroll_employee(employee_id)
        case, open_deductions = parse_settlement(payload)
        Settlement = request.env['webvue.hr.payroll.eos.settlement']
        Audit = request.env['webvue.hr.audit.event']
        before = Audit._webvue_policy_snapshot(Settlement._webvue_current(employee))
        with unique_conflict('a final settlement was saved for this departure at the same time'):
            settlement = Settlement._webvue_save_draft(employee, case, open_deductions)
            Audit._webvue_log('settlement_saved', settlement, before)
        return dump_settlement(settlement)

    @http.route(f'{EOS_ROUTE}/<int:employee_id>/settlement/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.approve')
    def confirm_settlement(self, employee_id, **_):
        settlement = _settlement(payroll_employee(employee_id))
        Audit = request.env['webvue.hr.audit.event']
        before = Audit._webvue_policy_snapshot(settlement)
        settlement._webvue_confirm()
        Audit._webvue_log('settlement_confirmed', settlement, before)
        return dump_settlement(settlement)

    @http.route('/api/v1/hr/payroll/eos-cases', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_cases(self, **_):
        reasons = request.env['hr.departure.reason'].search([], order='sequence, id')
        return {'items': [_case_item(reason) for reason in reasons], 'total': len(reasons)}

    @http.route('/api/v1/hr/payroll/eos-cases', type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.config')
    def put_case(self, **payload):
        revision, payload = split_revision(payload, minimum=0)
        reason, case = parse_case_map(payload, request.env)
        Case = request.env['webvue.hr.payroll.eos.case']
        Audit = request.env['webvue.hr.audit.event']
        current = Case._webvue_company_row(reason, current_company())
        require_revision(current, revision, CASE_CONFLICT)
        before = Audit._webvue_policy_snapshot(current)
        with unique_conflict(CASE_CONFLICT):
            row = Case._webvue_set_case(reason, current_company(), case)
            Audit._webvue_log('eos_case_changed', row, before)
        return _case_item(reason)
