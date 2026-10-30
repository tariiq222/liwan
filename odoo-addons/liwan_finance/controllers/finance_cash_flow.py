# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import parse_period, require_capability
from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_finance.serializers.cash_flow import dump_cash_flow


class FinanceCashFlowController(http.Controller):

    @http.route('/api/v1/finance/reports/cash-flow', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('finance.enabled', operation='read')
    def cash_flow(self, **_):
        """The statement of cash flows of a period by the indirect method, from the posted journal items.

        ``difference`` is the check against the change of the cash accounts (zero when it closes); ``statutory`` is false:
        this is an accounting statement built from the books, not a filed one.
        """
        require_capability('finance.statements.read')
        date_from, date_to = parse_period(request.httprequest.args)
        company = request.env.company
        figures = request.env['liwan.finance.cash.flow']._liwan_cash_flow(company, date_from, date_to)
        return dump_cash_flow(company, date_from, date_to, figures)
