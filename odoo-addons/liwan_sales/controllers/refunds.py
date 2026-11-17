# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_payments.models.access_service import REFUND
from odoo.addons.liwan_payments.models.order_service import (
    RefundConflict,
    RefundRefused,
)
from odoo.addons.liwan_payments.serializers.order import parse_refund
from odoo.addons.liwan_sales.models.access_service import READ
from odoo.addons.liwan_sales.serializers.order import dump_order


class SalesRefundsController(http.Controller):
    """The refund of money a staff quotation holds, recorded by Sales staff who may also refund payments."""

    @http.route('/api/v1/sales/orders/<int:order_id>/refunds', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', 'payments.enabled', operation='write')
    @requires_capability(READ, REFUND)
    def record_refund(self, order_id, **payload):
        refund = parse_refund(payload)
        try:
            order = request.env['liwan.sales.service']._liwan_refund(order_id, refund['amount'], refund['reference'])
        except RefundRefused as error:
            raise ApiError(422, 'invalid', str(error), field='amount') from error
        except RefundConflict as error:
            raise ApiError(409, 'conflict', str(error)) from error
        return dump_order(order, request.env.user)
