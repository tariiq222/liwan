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
from odoo.addons.liwan_sales.models.access_service import READ
from odoo.addons.liwan_sales.serializers.order import (
    dump_order,
    dump_orders,
    parse_mine,
    parse_order_filters,
)


def _visible_orders(extra=()):
    """The orders the caller reads in the working company, narrowed by ``extra``."""
    user = request.env.user
    domain = request.env['liwan.sales.visibility']._liwan_domain(user)
    return request.env['sale.order'], [*domain, *extra]


class SalesOrdersController(http.Controller):

    @http.route('/api/v1/sales/orders', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(READ)
    def list_orders(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        extra = parse_order_filters(args)
        if parse_mine(args):
            extra.append(('user_id', '=', request.env.user.id))
        orders, domain = _visible_orders(extra)
        found = orders.search(domain, order='date_order desc, id desc', limit=limit, offset=offset)
        return {'items': dump_orders(found), 'total': orders.search_count(domain)}

    @http.route('/api/v1/sales/orders/<int:order_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(READ)
    def get_order(self, order_id, **_):
        orders, domain = _visible_orders([('id', '=', order_id)])
        order = orders.search(domain, limit=1)
        if not order:
            raise ApiError(404, 'not_found', 'order not found')
        return dump_order(order, request.env.user)
