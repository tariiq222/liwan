# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_period, require_capability
from .statement_support import parse_only_posted, parse_required_day
from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_finance.serializers.mis import (
    dump_balance_sheet,
    dump_profit_loss,
    dump_zakat_base,
)


def _fiscal_year_start(company, day):
    return company.compute_fiscalyear_dates(day)['date_from']


class FinanceMisReportController(http.Controller):
    """Profit and loss, balance sheet and the Zakat base: the MIS templates of ``data/finance_mis_reports.xml``."""

    @http.route('/api/v1/finance/reports/profit-loss', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def profit_loss(self, **_):
        """Revenue, costs, expenses and profit of a period (the MIS template ``mis_report_profit_loss``)."""
        require_capability('finance.statements.read')
        date_from, date_to = parse_period(request.httprequest.args)
        only_posted = parse_only_posted()
        company = request.env.company
        _template, amounts = request.env['liwan.finance.mis.report']._liwan_evaluate(
            'liwan_finance.mis_report_profit_loss', company, date_from, date_to, only_posted, exclude_closing=True,
        )
        return dump_profit_loss(company, date_from, date_to, only_posted, amounts)

    @http.route('/api/v1/finance/reports/balance-sheet', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def balance_sheet(self, **_):
        """The position at ``date_to``; the current year earnings run from the start of its fiscal year."""
        require_capability('finance.statements.read')
        date_to = parse_required_day('date_to')
        only_posted = parse_only_posted()
        company = request.env.company
        _template, amounts = request.env['liwan.finance.mis.report']._liwan_evaluate(
            'liwan_finance.mis_report_balance_sheet', company, _fiscal_year_start(company, date_to), date_to, only_posted,
        )
        return dump_balance_sheet(company, date_to, only_posted, amounts)

    @http.route('/api/v1/finance/reports/zakat-base', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def zakat_base(self, **_):
        """A simplified Zakat base at ``date_to``: the formula is data and must be reviewed by a Saudi CPA."""
        require_capability('finance.zakat.read')
        date_to = parse_required_day('date_to')
        only_posted = parse_only_posted()
        company = request.env.company
        zakat = request.env['liwan.finance.zakat']
        template, amounts, figures = zakat._liwan_template_figures(company, date_to, only_posted)
        workpaper = zakat._liwan_workpaper(company, date_to, figures)
        return dump_zakat_base(company, date_to, only_posted, template, amounts, workpaper)
