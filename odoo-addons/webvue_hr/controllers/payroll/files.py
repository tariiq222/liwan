# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import content_disposition, request

from .common import scoped_profile
from .runs import scoped_run
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_hr.controllers.common import hr_rule_handler
from odoo.addons.webvue_hr.models.hr_payslip_run import EDITABLE_STATES
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date
from odoo.addons.webvue_hr.serializers.payroll.files import dump_gosi_statement
from odoo.addons.webvue_hr.serializers.payroll.run import run_states

RUN = '/api/v1/hr/payroll/runs/<int:run_id>'
DEFAULT_PROFILES = {'bank': 'webvue_hr.profile_generic_csv', 'wps': 'webvue_hr.profile_mudad_wps'}


def _approved_run(run_id):
    """The run once its figures are fixed (approved or any later state a bridge adds) → 403 otherwise."""
    run = scoped_run(run_id)
    if run.webvue_state not in set(run_states(request.env)) - set(EDITABLE_STATES):
        raise ApiError(403, 'transition_forbidden', 'the salary files need an approved payroll run')
    return run


def _profile(args, kind):
    """The requested profile, or the shared one of this kind; a profile of the other kind → 422."""
    if args.get('profile_id') in (None, ''):
        profile = request.env.ref(DEFAULT_PROFILES[kind])
    else:
        profile = scoped_profile(parse_positive_int(args['profile_id'], 'profile_id'))
    if profile.kind != kind:
        raise ApiError(422, 'invalid', f'profile_id must be a {kind} profile', field='profile_id')
    return profile


def _require_iban(lines):
    missing = [line.employee_id for line in lines if line.net > 0 and not line.iban]
    if missing:
        raise ApiError(422, 'missing_iban', 'an employee to be paid has no IBAN', field='iban', details={'employee_ids': missing})


def _month(run):
    return run.date_start.strftime('%Y-%m')


def _csv_response(content, filename):
    return request.make_response(content, headers=[
        ('Content-Type', 'text/csv; charset=utf-8'),
        ('Content-Disposition', content_disposition(filename)),
    ])


class HrPayrollFilesController(http.Controller):

    @http.route(f'{RUN}/bank-file', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def bank_file(self, run_id, **_):
        """The bank salary file of a fixed run: employees with a net to pay, each of them with an IBAN."""
        run = _approved_run(run_id)
        args = request.httprequest.args
        profile = _profile(args, 'bank')
        value_date = parse_optional_date(args.get('value_date'), 'value_date') or fields.Date.context_today(run)
        export = request.env['webvue.hr.payroll.export']
        lines = [line for line in export._webvue_salary_lines(run) if line.net > 0]
        _require_iban(lines)
        return _csv_response(export._webvue_render(profile, lines, value_date), f'salaries-{_month(run)}.csv')

    @http.route(f'{RUN}/wps-file', type='http', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def wps_file(self, run_id, **_):
        """The WPS file of a fixed run: every payslip, zero net included, once its totals add up."""
        run = _approved_run(run_id)
        profile = _profile(request.httprequest.args, 'wps')
        export = request.env['webvue.hr.payroll.export']
        lines = export._webvue_salary_lines(run)
        export._webvue_check_totals(lines)
        _require_iban(lines)
        return _csv_response(
            export._webvue_render(profile, lines, fields.Date.context_today(run)), f'wps-{_month(run)}.csv',
        )

    @http.route(f'{RUN}/gosi-statement', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def gosi_statement(self, run_id, **_):
        return dump_gosi_statement(request.env['webvue.hr.payroll.export']._webvue_gosi_statement(_approved_run(run_id)))
