# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""/api/v1/hr/offboarding: departure reasons, the departure register and its clearance."""
from odoo import Command, http
from odoo.http import request

from .common import (
    EMPLOYEE_MODEL,
    OFFBOARDING,
    _clearance_runs,
    _employee,
    _launch_run,
    _missing,
    _purpose_plan,
    _reject_self_decision,
    _require,
)
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.common import hr_rule_handler
from odoo.addons.liwan_hr.serializers.lifecycle.departure import (
    clearance_done,
    dump_departure,
    parse_cleared,
    parse_departure_create,
    parse_departure_patch,
)
from odoo.addons.liwan_hr.serializers.lifecycle.fields import ref


def _departure_reason(reason_id):
    """A reason of the company's country (or a shared one); anything else is a 422."""
    reason = request.env['hr.departure.reason'].search([
        ('id', '=', reason_id),
        ('country_id', 'in', [request.env.company.country_id.id, False]),
    ], limit=1)
    if not reason:
        raise ApiError(422, 'invalid', 'departure_reason_id is not available', field='departure_reason_id')
    return reason


def _departure_reasons():
    reasons = request.env['hr.departure.reason'].search([
        ('country_id', 'in', [request.env.company.country_id.id, False]),
    ], order='sequence, id')
    return {'items': [ref(reason) for reason in reasons], 'total': len(reasons)}


def _clearance_run(employee):
    """The latest offboarding run of EMPLOYEE, or an empty recordset."""
    return _clearance_runs().get(employee.id, request.env['liwan.hr.plan.run'])


def _departed_employee(employee_id):
    employee = _employee(employee_id)
    if not employee.departure_date:
        _missing('hr.employee departure', employee_id)
    return employee


def _register_departure(payload):
    vals = parse_departure_create(payload)
    employee = _employee(vals['employee_id'])
    _reject_self_decision(employee)
    if employee.departure_date:
        raise ApiError(422, 'invalid', 'this employee already has a departure date', field='departure_date')
    reason = _departure_reason(vals['departure_reason_id'])
    # The request company is already pinned by api_handler; no extra context.
    wizard = request.env['hr.departure.wizard'].create({
        'employee_ids': [Command.set([employee.id])],
        'departure_reason_id': reason.id,
        'departure_date': vals['departure_date'],
        'departure_description': vals['description'],
        'set_date_end': vals['set_contract_end'],
        'remove_related_user': False,
        # The custody stays with the employee until the clearance step returns it; the wizard would free it at
        # once, even for a departure months ahead.
        'unassign_equipment': False,
    })
    wizard.action_register_departure()
    if vals['plan_id']:
        # The clearance checklist is an offboarding plan run of the same request.
        _launch_run(OFFBOARDING, employee, _purpose_plan(OFFBOARDING, vals['plan_id']))
    employee = _departed_employee(vals['employee_id'])
    return request.make_json_response(
        dump_departure(employee, _clearance_run(employee)), status=201,
    )


def _move_contract_end(employee, vals):
    """Carry the contract end the departure set along with a corrected departure date.

    The register step ends the current contract on the departure date; a contract end that still
    equals the old departure date was set by it, so it follows the new date (a later or earlier end
    the user chose by hand stays as it is).
    """
    version = employee.version_id
    if not version.contract_date_start or version.contract_date_end != employee.departure_date:
        return
    if vals['departure_date'] < version.contract_date_start:
        raise ApiError(
            422, 'invalid', "departure_date can't be earlier than the contract start", field='departure_date',
        )
    vals['contract_date_end'] = vals['departure_date']


def _patch_departure(employee_id, payload):
    vals = parse_departure_patch(payload)
    employee = _departed_employee(employee_id)
    _reject_self_decision(employee)
    if 'departure_reason_id' in vals:
        vals['departure_reason_id'] = _departure_reason(vals['departure_reason_id']).id
    if 'departure_date' in vals:
        _move_contract_end(employee, vals)
    employee._liwan_write(vals)
    return dump_departure(employee, _clearance_run(employee))


def _list_departures():
    args = request.httprequest.args
    limit, offset = parse_page(args)
    cleared = parse_cleared(args.get('cleared'))
    query = (args.get('q') or '').strip()
    latest = _clearance_runs()
    cleared_ids = [employee_id for employee_id, run in latest.items() if clearance_done(run)]
    domain = [
        ('company_id', 'in', request.env.companies.ids),
        ('departure_date', '!=', False),
    ]
    if query:
        domain.append(('name', 'ilike', query))
    if cleared is True:
        if not cleared_ids:
            return {'items': [], 'total': 0}
        domain.append(('id', 'in', cleared_ids))
    elif cleared is False and cleared_ids:
        domain.append(('id', 'not in', cleared_ids))
    Employee = request.env[EMPLOYEE_MODEL].with_context(active_test=False)
    employees = Employee.search(domain, order='departure_date desc, id', limit=limit, offset=offset)
    return {
        'items': [dump_departure(employee, latest.get(employee.id)) for employee in employees],
        'total': Employee.search_count(domain),
    }


class HrLifecycleDepartureController(http.Controller):

    @http.route('/api/v1/hr/offboarding/reasons', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def list_departure_reasons(self, **_):
        _require('hr.offboarding.read')
        return _departure_reasons()

    @http.route('/api/v1/hr/offboarding/departures', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def list_departures(self, **_):
        _require('hr.offboarding.read')
        return _list_departures()

    @http.route('/api/v1/hr/offboarding/departures', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def register_departure(self, **payload):
        _require('hr.offboarding.manage')
        return _register_departure(payload)

    @http.route('/api/v1/hr/offboarding/departures/<int:employee_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='read')
    def get_departure(self, employee_id):
        _require('hr.offboarding.read')
        employee = _departed_employee(employee_id)
        return dump_departure(employee, _clearance_run(employee))

    @http.route('/api/v1/hr/offboarding/departures/<int:employee_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.offboarding', operation='write')
    def patch_departure(self, employee_id, **payload):
        _require('hr.offboarding.manage')
        return _patch_departure(employee_id, payload)
