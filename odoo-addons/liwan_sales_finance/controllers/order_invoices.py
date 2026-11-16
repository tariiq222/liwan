# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The invoice of a confirmed staff order.

The route needs Sales and Finance both in the plan and both capabilities in the working company: ``sales.orders.confirm``
(the right to take an order forward) and ``finance.invoices.manage`` (the right to draft a customer invoice). Sales decides
which order the caller reads and Stock's ``sale.advance.payment.inv`` makes the invoice; finance posts it. The answer is
the staff order, whose ``invoicing`` block lists the invoice. Nothing here uses ``sudo()``.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_finance.controllers.idempotency import idempotent
from odoo.addons.liwan_sales.models.access_service import ORDERS_CONFIRM
from odoo.addons.liwan_sales.serializers.order import dump_order
from odoo.addons.liwan_sales_finance.serializers.order_invoice import (
    parse_invoice_body,
)


class SalesOrderInvoicesController(http.Controller):

    @http.route('/api/v1/sales/orders/<int:order_id>/invoices', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', 'finance.enabled', operation='write')
    @requires_capability(ORDERS_CONFIRM, 'finance.invoices.manage')
    @idempotent
    def create_order_invoice(self, order_id, **payload):
        order = request.env['liwan.sales.service']._liwan_invoice(order_id, parse_invoice_body(payload))
        return dump_order(order, request.env.user)
