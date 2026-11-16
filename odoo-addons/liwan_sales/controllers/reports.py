# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.csv_export import refuse_oversized_export
from odoo.addons.liwan_sales.models.access_service import READ, REPORTS_READ
from odoo.addons.liwan_sales.serializers.reports import (
    DEFAULT_STATES,
    dump_breakdown,
    dump_summary,
    export_csv,
    parse_breakdown,
    parse_report_filters,
)

# A report reads aggregated documents, so it needs the right to read them too: no capability implies another.
CAPABILITIES = (REPORTS_READ, READ)


def _reports():
    return request.env['liwan.sales.reports']


class SalesReportsController(http.Controller):

    @http.route('/api/v1/sales/reports/summary', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(*CAPABILITIES)
    def summary(self, **_):
        """Orders and amounts of the documents the caller reads: confirmed orders, open quotations and cancelled ones."""
        reports = _reports()
        rows = reports._liwan_summary_rows(parse_report_filters(request.httprequest.args))
        return dump_summary(reports._liwan_currency(), rows)

    @http.route('/api/v1/sales/reports/breakdown', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(*CAPABILITIES)
    def breakdown(self, **_):
        """The amounts grouped by ``by`` (``period``, ``salesperson``, ``customer`` or ``product``), confirmed orders unless ``state`` says otherwise."""
        args = request.httprequest.args
        by, period = parse_breakdown(args)
        limit, offset = parse_page(args)
        filters = parse_report_filters(args, default_states=DEFAULT_STATES)
        reports = _reports()
        rows = reports._liwan_breakdown_rows(filters, by, period)
        return dump_breakdown(by, period, reports._liwan_currency(), rows, limit, offset)

    @http.route('/api/v1/sales/reports/export', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(*CAPABILITIES)
    def export_rows(self, **_):
        """The detail rows behind the breakdown filters (confirmed orders unless ``state`` says otherwise) as CSV."""
        filters = parse_report_filters(request.httprequest.args, default_states=DEFAULT_STATES)
        reports = _reports()
        count = reports._liwan_export_count(filters)
        refuse_oversized_export(count)
        lines = reports._liwan_export_lines(filters)
        filename = f'sales-report-{fields.Date.context_today(lines)}.csv'
        return request.make_response(export_csv(lines, reports._liwan_currency()), headers=[
            ('Content-Type', 'text/csv; charset=utf-8'),
            ('Content-Disposition', content_disposition(filename)),
            ('Cache-Control', 'private, no-store'),
            ('X-Content-Type-Options', 'nosniff'),
        ])
