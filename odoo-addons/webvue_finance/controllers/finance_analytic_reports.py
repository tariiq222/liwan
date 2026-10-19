# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import list_page, parse_period, require_capability
from .finance_analytic import find_analytic_account
from .write_support import company_records
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.analytic import (
    dump_analytic_report,
    dump_analytic_report_lines,
)


class FinanceAnalyticReportController(http.Controller):

    @http.route('/api/v1/finance/reports/analytic', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def analytic_report(self, **_):
        """Income, expense and net per cost center of the current company; ``plan_id`` limits it to a plan and its sub-plans."""
        require_capability('finance.analytic.read')
        args = request.httprequest.args
        date_from, date_to = parse_period(args)
        Plan = request.env['account.analytic.plan']
        plan = company_records('account.analytic.plan', [parse_positive_int(args['plan_id'], 'plan_id')], 'plan_id') if args.get('plan_id') else Plan
        company = request.env.company
        rows = request.env['webvue.finance.analytic.report']._webvue_analytic_rows(company, date_from, date_to, plan)
        return dump_analytic_report(company, date_from, date_to, plan, rows)

    @http.route('/api/v1/finance/reports/analytic/lines', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def analytic_report_lines(self, **_):
        """The analytic items behind one row of the report (``account_id`` is required), newest first, paged."""
        require_capability('finance.analytic.read')
        args = request.httprequest.args
        if not args.get('account_id'):
            raise ApiError(422, 'invalid', 'account_id is required', field='account_id')
        date_from, date_to = parse_period(args)
        account = find_analytic_account(parse_positive_int(args['account_id'], 'account_id'))
        domain = request.env['webvue.finance.analytic.report']._webvue_account_lines_domain(
            request.env.company, date_from, date_to, account,
        )
        return list_page('account.analytic.line', domain, dump_analytic_report_lines)
