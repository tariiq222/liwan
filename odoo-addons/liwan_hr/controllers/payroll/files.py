# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import content_disposition, request

from .common import scoped_profile
from .runs import scoped_run
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_hr.controllers.common import hr_rule_handler
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date
from odoo.addons.liwan_hr.serializers.payroll.files import dump_gosi_statement

RUN = '/api/v1/hr/payroll/runs/<int:run_id>'
DEFAULT_PROFILES = {'bank': 'liwan_hr.profile_generic_csv', 'wps': 'liwan_hr.profile_mudad_wps'}


def _approved_run(run_id):
    """The run once its figures are fixed (approved or any later state a bridge adds) → 403 otherwise."""
    run = scoped_run(run_id)
    if run._liwan_is_editable():
        raise ApiError(403, 'transition_forbidden', 'the salary files need an approved payroll run')
    return run


def _require_same_site_json():
    """CSRF guard of a request that writes: a JSON body and no cross-site origin, like ``assertSameSiteJson``.

    A plain cross-site ``<form>`` cannot send ``application/json`` and a cross-site ``fetch`` that does needs a
    CORS preflight Odoo never grants, so the media type carries the defence; ``Sec-Fetch-Site`` additionally
    rejects anything the browser labels as coming from another origin. Odoo's json2 dispatcher alone lets an
    empty-bodied request of any media type through, which is why the type is checked here.
    """
    httprequest = request.httprequest
    if httprequest.mimetype != 'application/json':
        raise ApiError(415, 'unsupported_media_type', 'JSON only')
    if httprequest.headers.get('Sec-Fetch-Site', 'same-origin') not in ('same-origin', 'none'):
        raise ApiError(403, 'cross_site_request', 'cross-site request rejected')


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


def _kept_response(run, kind, profile, value_date, content, filename):
    """Keep the generated file and log its handing out, then answer it as the download."""
    kept = request.env['liwan.hr.payroll.file']._liwan_keep(run, kind, profile, value_date, filename, content)
    request.env['liwan.hr.audit.event']._liwan_log('payment_file_generated', kept)
    return _csv_response(content, filename)


def _csv_response(content, filename):
    """A salary file: never cached by the browser or a proxy, and never sniffed into another type."""
    return request.make_response(content, headers=[
        ('Content-Type', 'text/csv; charset=utf-8'),
        ('Content-Disposition', content_disposition(filename)),
        ('Cache-Control', 'private, no-store'),
        ('X-Content-Type-Options', 'nosniff'),
    ])


class HrPayrollFilesController(http.Controller):

    # A write: every download keeps the file it hands out and logs it (owner decision D-4), so it is a POST that
    # needs a same-site JSON request (a GET is not CSRF-protected) and a read-only tenant (expired, or suspended with
    # support signed in) is refused 403 ``tenant_read_only`` before any file is generated, kept or logged, a file
    # kept earlier included (owner decisions 2026-10-26). The profile and value date travel in the JSON body.
    @http.route(f'{RUN}/bank-file', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.read')
    def bank_file(self, run_id, **payload):
        """The bank salary file of a fixed run: employees with a net to pay, each of them with an IBAN."""
        _require_same_site_json()
        run = _approved_run(run_id)
        profile = _profile(payload, 'bank')
        value_date = parse_optional_date(payload.get('value_date'), 'value_date') or fields.Date.context_today(run)
        export = request.env['liwan.hr.payroll.export']
        lines = [line for line in export._liwan_salary_lines(run) if line.net > 0]
        _require_iban(lines)
        content = export._liwan_render(profile, lines, value_date)
        return _kept_response(run, 'bank', profile, value_date, content, f'salaries-{_month(run)}.csv')

    # A write, like the bank file: see above.
    @http.route(f'{RUN}/wps-file', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='write')
    @requires_capability('hr.payroll.read')
    def wps_file(self, run_id, **payload):
        """The WPS file of a fixed run: every payslip, zero net included, once its totals add up."""
        _require_same_site_json()
        run = _approved_run(run_id)
        profile = _profile(payload, 'wps')
        export = request.env['liwan.hr.payroll.export']
        lines = export._liwan_salary_lines(run)
        export._liwan_check_totals(lines)
        _require_iban(lines)
        value_date = fields.Date.context_today(run)
        content = export._liwan_render(profile, lines, value_date)
        return _kept_response(run, 'wps', profile, value_date, content, f'wps-{_month(run)}.csv')

    @http.route(f'{RUN}/gosi-statement', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @hr_rule_handler
    @requires_feature('hr.enabled', 'hr.payroll', operation='read')
    @requires_capability('hr.payroll.read')
    def gosi_statement(self, run_id, **_):
        return dump_gosi_statement(request.env['liwan.hr.payroll.export']._liwan_gosi_statement(_approved_run(run_id)))
