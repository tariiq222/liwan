# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_choice, parse_period, require_capability
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_feature,
)
from odoo.addons.webvue_finance.serializers.report import (
    dump_vat_return,
    dump_vat_return_item,
    dump_vat_summary,
    dump_withholding_summary,
)

# The boxes of the Saudi VAT return (the codes of the report lines).
BOX_CODES = tuple(f'sa_{number}' for number in range(1, 17))


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

    @http.route('/api/v1/finance/reports/vat-return', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def vat_return(self, **_):
        """The boxes of the Saudi VAT return (1 to 16) for a period, from the tax tags of the posted journal items.

        The answer is a draft for the taxpayer's review (``status``), never a filed return (``filed`` is false): the
        return is submitted by the taxpayer on the ZATCA portal.
        """
        require_capability('finance.reports.read')
        date_from, date_to = parse_period(request.httprequest.args)
        company = request.env.company
        boxes = request.env['webvue.finance.vat.return']._webvue_vat_return(company, date_from, date_to)
        return dump_vat_return(company, date_from, date_to, boxes)

    @http.route('/api/v1/finance/reports/vat-return/items', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def vat_return_items(self, **_):
        """The journal items behind one column (``base`` or ``tax``) of one box (``sa_1``..): drill-down to the documents."""
        require_capability('finance.reports.read')
        args = request.httprequest.args
        date_from, date_to = parse_period(args)
        code = parse_choice(args.get('code'), BOX_CODES, 'code')
        column = parse_choice(args.get('column'), ('base', 'tax'), 'column')
        if not code or not column:
            raise ApiError(422, 'invalid', 'code and column are required', field='code' if not code else 'column')
        limit, offset = parse_page(args)
        rows = request.env['webvue.finance.vat.return']._webvue_items(request.env.company, code, column, date_from, date_to)
        return {'items': [dump_vat_return_item(item, amount) for item, amount in rows[offset:offset + limit]], 'total': len(rows)}
