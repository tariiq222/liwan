# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, time, timedelta

import pytz

from odoo import api, models

# The breakdowns: each is a stock ``sale.report`` column the amounts are grouped by.
DIMENSIONS = {'period': 'date', 'salesperson': 'user_id', 'customer': 'partner_id', 'product': 'product_tmpl_id'}
EXPORT_ORDER = 'date desc, id desc'
ORDERS = 'order_reference:count_distinct'


class LiwanSalesReports(models.AbstractModel):
    """The figures of the Sales reports, read from stock's sales analysis (``sale.report``) through the ORM.

    Every read starts from the visibility domain the lists use, so a report counts exactly the documents the caller
    reads (the record rules of ``security/sales_rules.xml`` say the same on every ORM path). A row of the analysis is a
    product line group of an order; a line without a product (the section and the lines stock adds for a down payment)
    carries no quantity and no amount and is left out. Amounts are in the currency of the working company: stock
    converts each order from its own currency at the rate recorded on the order.
    """

    _name = 'liwan.sales.reports'
    _description = 'LiwanOS Sales reports'

    @api.model
    def _liwan_domain(self, filters):
        """The report rows the caller may read, narrowed by ``filters`` (the output of ``parse_report_filters``)."""
        domain = [*self.env['liwan.sales.visibility']._liwan_domain(self.env.user), ('product_id', '!=', False)]
        if 'date_from' in filters:
            domain.append(('date', '>=', self._liwan_day_start(filters['date_from'])))
        if 'date_to' in filters:
            domain.append(('date', '<', self._liwan_day_start(filters['date_to'] + timedelta(days=1))))
        for key, field in (('salesperson_id', 'user_id'), ('customer_id', 'partner_id'), ('product_id', 'product_tmpl_id')):
            if key in filters:
                domain.append((field, '=', filters[key]))
        if 'states' in filters:
            domain.append(('state', 'in', filters['states']))
        if 'source' in filters:
            domain.append(('liwan_staff_document', '=', filters['source'] == 'staff'))
        return domain

    @api.model
    def _liwan_day_start(self, day):
        """The UTC moment the calendar ``day`` starts for the caller, as the naive datetime the order date is stored in."""
        local = self.env.tz.localize(datetime.combine(day, time.min))
        return local.astimezone(pytz.utc).replace(tzinfo=None)

    @api.model
    def _liwan_currency(self):
        return self.env.company.currency_id

    @api.model
    def _liwan_summary_rows(self, filters):
        """``{stock state: (orders, untaxed, total)}`` of the rows behind ``filters``."""
        rows = self.env['sale.report']._read_group(
            self._liwan_domain(filters), ['state'], [ORDERS, 'price_subtotal:sum', 'price_total:sum'],
        )
        return {state: tuple(figures) for state, *figures in rows}

    @api.model
    def _liwan_breakdown_rows(self, filters, by, period):
        """``(group, orders, quantity, untaxed, total)`` rows of ``by`` (grouped by ``period`` for the ``period`` dimension).

        A period comes oldest first; every other dimension by total amount, largest first.
        """
        group = f'{DIMENSIONS[by]}:{period}' if period else DIMENSIONS[by]
        return self.env['sale.report']._read_group(
            self._liwan_domain(filters), [group], [ORDERS, 'product_uom_qty:sum', 'price_subtotal:sum', 'price_total:sum'],
            order=f'{group} asc' if period else 'price_total:sum desc',
        )

    @api.model
    def _liwan_export_count(self, filters):
        return self.env['sale.report'].search_count(self._liwan_domain(filters))

    @api.model
    def _liwan_export_lines(self, filters):
        """The report rows behind ``filters``, newest first, as records of ``sale.report``."""
        return self.env['sale.report'].search(self._liwan_domain(filters), order=EXPORT_ORDER)
