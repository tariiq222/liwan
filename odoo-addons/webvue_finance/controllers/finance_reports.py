# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_period, require_capability
from odoo.addons.webvue_api.controllers.common import api_handler, requires_feature
from odoo.addons.webvue_finance.serializers.report import (
    dump_vat_summary,
    dump_withholding_summary,
)


class FinanceReportController(http.Controller):

    @http.route('/api/v1/finance/reports/vat', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def vat_summary(self, **_):
        """Group taxes appear as their child taxes, cash-basis taxes at the invoice date, current company only."""
        require_capability('finance.reports.read')
        date_from, date_to = parse_period(request.httprequest.args)
        company = request.env.company
        totals = request.env['webvue.finance.vat.report']._webvue_vat_totals(company, date_from, date_to)
        return dump_vat_summary(company, date_from, date_to, totals)

    @http.route('/api/v1/finance/reports/withholding', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def withholding_summary(self, **_):
        """Tax withheld from vendor payments per withholding tax, current company only."""
        require_capability('finance.reports.read')
        date_from, date_to = parse_period(request.httprequest.args)
        company = request.env.company
        totals = request.env['webvue.finance.withholding.report']._webvue_withholding_totals(company, date_from, date_to)
        return dump_withholding_summary(company, date_from, date_to, totals)
