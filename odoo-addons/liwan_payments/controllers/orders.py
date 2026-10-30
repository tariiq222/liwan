# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_payments.models.access_service import (
    ORDERS_READ,
    REFUND,
)
from odoo.addons.liwan_payments.models.order_service import (
    RefundConflict,
    RefundRefused,
)
from odoo.addons.liwan_payments.serializers.order import (
    dump_order_detail,
    dump_order_item,
    parse_order_filters,
    parse_refund,
)

FEATURE = 'payments.enabled'
ORDER_PATH = '/api/v1/payments/orders/<int:order_id>'


def _service():
    return request.env['liwan.payments.service']


def _company_order(order_id):
    """The current company's online order ``order_id``; any other is the same 404 as a missing one."""
    order = _service()._liwan_company_order(request.env.company, order_id)
    if not order:
        raise ApiError(404, 'not_found', 'order not found')
    return order


class PaymentOrdersController(http.Controller):
    """The current company's online orders for its payments staff, and the refunds they record."""

    @http.route('/api/v1/payments/orders', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(ORDERS_READ)
    def list_orders(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        service = _service()
        orders, total = service._liwan_company_orders(
            request.env.company, **parse_order_filters(args), limit=limit, offset=offset,
        )
        return {'items': [dump_order_item(service, order) for order in orders], 'total': total}

    @http.route(ORDER_PATH, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    @requires_capability(ORDERS_READ)
    def get_order(self, order_id, **_):
        return dump_order_detail(_service(), _company_order(order_id))

    @http.route(ORDER_PATH + '/refunds', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(REFUND)
    def record_refund(self, order_id, **payload):
        refund = parse_refund(payload)
        order = _company_order(order_id)
        try:
            _service()._liwan_record_refund(order, refund['amount'], refund['reference'])
        except RefundRefused as error:
            raise ApiError(422, 'invalid', str(error), field='amount') from error
        except RefundConflict as error:
            raise ApiError(409, 'conflict', str(error)) from error
        return dump_order_detail(_service(), order)
