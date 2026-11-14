# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_sales.models.access_service import (
    DOCUMENTS_ASSIGN,
    ORDERS_CONFIRM,
    QUOTATIONS_MANAGE,
    READ,
)
from odoo.addons.liwan_sales.serializers.order import (
    dump_order,
    dump_orders,
    dump_salespeople,
    parse_assign_body,
    parse_mine,
    parse_order_body,
    parse_order_filters,
)


def _visible_orders(extra=()):
    """The orders the caller reads in the working company, narrowed by ``extra``."""
    user = request.env.user
    domain = request.env['liwan.sales.visibility']._liwan_domain(user)
    return request.env['sale.order'], [*domain, *extra]


def _service():
    return request.env['liwan.sales.service']


def _detail(order):
    return dump_order(order, request.env.user)


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
        return _detail(_service()._liwan_order(order_id))

    @http.route('/api/v1/sales/orders', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(QUOTATIONS_MANAGE)
    def create_order(self, **payload):
        return _detail(_service()._liwan_create(parse_order_body(payload, creating=True)))

    @http.route('/api/v1/sales/orders/<int:order_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(QUOTATIONS_MANAGE)
    def update_order(self, order_id, **payload):
        return _detail(_service()._liwan_update(order_id, parse_order_body(payload, creating=False)))

    @http.route([
        '/api/v1/sales/orders/<int:order_id>/confirm',
        '/api/v1/sales/orders/<int:order_id>/reopen',
        '/api/v1/sales/orders/<int:order_id>/lock',
        '/api/v1/sales/orders/<int:order_id>/unlock',
    ], type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(ORDERS_CONFIRM)
    def move_order(self, order_id, **_):
        action = request.httprequest.path.rsplit('/', 1)[1]
        return _detail(_service()._liwan_transition(order_id, action))

    @http.route('/api/v1/sales/orders/<int:order_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(QUOTATIONS_MANAGE, ORDERS_CONFIRM, match='any')
    def cancel_order(self, order_id, **_):
        return _detail(_service()._liwan_transition(order_id, 'cancel'))

    @http.route('/api/v1/sales/orders/<int:order_id>/duplicate', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(QUOTATIONS_MANAGE)
    def duplicate_order(self, order_id, **_):
        return _detail(_service()._liwan_duplicate(order_id))

    @http.route('/api/v1/sales/orders/<int:order_id>/assign', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('sales.enabled', operation='write')
    @requires_capability(DOCUMENTS_ASSIGN)
    def assign_order(self, order_id, **payload):
        return _detail(_service()._liwan_assign(order_id, parse_assign_body(payload)))

    @http.route('/api/v1/sales/salespeople', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('sales.enabled', operation='read')
    @requires_capability(DOCUMENTS_ASSIGN)
    def list_salespeople(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        people = _service()._liwan_salespeople(request.env.company, (args.get('q') or '').strip())
        return {'items': dump_salespeople(people[offset:offset + limit]), 'total': len(people)}
