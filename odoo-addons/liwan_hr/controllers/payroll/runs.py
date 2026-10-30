# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.common import hr_rule_handler, unique_conflict
from odoo.addons.liwan_hr.serializers.payroll.run import (
    dump_payslip_rows,
    dump_run,
    dump_run_summary,
    parse_inputs,
    parse_month,
    run_states,
)


def scoped_run(run_id):
    """A run of the current company → 404 otherwise: another company's run is never a 403."""
    run = request.env['hr.payslip.run'].search([
        ('id', '=', run_id), ('company_id', 'in', request.env.companies.ids),
    ], limit=1)
    if not run:
        raise MissingError(request.env._('hr.payslip.run %(id)s does not exist', id=run_id))
    return run


def _run_domain(args):
    domain = [('company_id', 'in', request.env.companies.ids)]
    year = args.get('year')
    if year not in (None, ''):
        if not (year.isdigit() and len(year) == 4):
            raise ApiError(422, 'invalid', 'year must be a four-digit year', field='year')
        year = int(year)
        domain += [('date_start', '>=', f'{year:04d}-01-01'), ('date_start', '<=', f'{year:04d}-12-31')]
    state = args.get('state')
    if state not in (None, ''):
        states = run_states(request.env)
        if state not in states:
            raise ApiError(422, 'invalid', f"state must be one of {', '.join(states)}", field='state')
        domain.append(('liwan_state', '=', state))
    return domain


class HrPayrollRunController(http.Controller):

    @http.route('/api/v1/hr/payroll/runs', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_runs(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = _run_domain(args)
        Run = request.env['hr.payslip.run']
        runs = Run.search(domain, order='date_start desc, id desc', limit=limit, offset=offset)
        return {'items': [dump_run_summary(run) for run in runs], 'total': Run.search_count(domain)}

    @http.route('/api/v1/hr/payroll/runs', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def create_run(self, **payload):
        month = parse_month(payload)
        with unique_conflict('a payroll run was created for this month at the same time'):
            run = request.env['hr.payslip.run']._liwan_create_month(month)
        return request.make_json_response(dump_run(run), status=201)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def get_run(self, run_id, **_):
        return dump_run(scoped_run(run_id))

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def delete_run(self, run_id, **_):
        scoped_run(run_id)._liwan_cancel()
        return request.make_json_response('', status=204)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>/compute', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def compute_run(self, run_id, **_):
        run = scoped_run(run_id)
        run._liwan_compute()
        return dump_run(run)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.approve')
    def approve_run(self, run_id, **_):
        run = scoped_run(run_id)
        run._liwan_approve()
        return dump_run(run)

    @http.route('/api/v1/hr/payroll/runs/<int:run_id>/payslips', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def list_payslips(self, run_id, **_):
        run = scoped_run(run_id)
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = [('payslip_run_id', '=', run.id)]
        if args.get('q'):
            domain.append(('employee_id.name', 'ilike', args['q']))
        Payslip = request.env['hr.payslip']
        payslips = Payslip.search(domain, order='employee_id, id', limit=limit, offset=offset)
        return {'items': dump_payslip_rows(payslips), 'total': Payslip.search_count(domain)}

    @http.route(
        '/api/v1/hr/payroll/runs/<int:run_id>/payslips/<int:payslip_id>/inputs',
        type='json2', auth='user', methods=['PATCH'], readonly=False,
    )
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.manage')
    def patch_inputs(self, run_id, payslip_id, **payload):
        run = scoped_run(run_id)
        values = parse_inputs(payload)
        payslip = run.slip_ids.filtered(lambda slip: slip.id == payslip_id)
        if not payslip:
            raise MissingError(request.env._('hr.payslip %(id)s does not exist', id=payslip_id))
        run._liwan_set_inputs(payslip, values)
        return dump_payslip_rows(payslip)[0]
