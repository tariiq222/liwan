# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    find_one,
    not_found,
    reject,
    visible_conversation,
)
from odoo.addons.webvue_inbox.models.access_service import READ
from odoo.addons.webvue_inbox_payments.controllers.parsing import (
    parse_checkout,
    parse_order_create,
    parse_order_patch,
)
from odoo.addons.webvue_inbox_payments.models.access_service import ORDERS_MANAGE
from odoo.addons.webvue_inbox_payments.models.constants import CATALOG_FEATURE
from odoo.addons.webvue_inbox_payments.models.order import (
    ORDER_STATES,
    OrderLinesInvalid,
    OrderLocked,
    PayTemplateInvalid,
    WindowClosed,
)
from odoo.addons.webvue_inbox_payments.serializers.order import dump_order
from odoo.addons.webvue_payments.controllers.links import FEATURE as PAYMENTS_FEATURE
from odoo.addons.webvue_payments.models.order_service import (
    NoGateway,
    NotInvoiceable,
    NotPayable,
)
from odoo.addons.webvue_payments.models.payer_service import CheckoutOpen

PAYMENT_STATUSES = ('payable', 'processing', 'paid', 'not_payable', 'cancelled')


def get_order(order_id):
    """An order of a conversation the caller may see; any other is a plain 404."""
    order = request.env['webvue.inbox.order'].search([('id', '=', order_id)], limit=1)
    if not order:
        raise not_found()
    visible_conversation(order.conversation_id.id)
    return order


def order_filters(args):
    """The list filters of the query string (state, channel_id, q); the visibility of the caller always applies."""
    Order = request.env['webvue.inbox.order']
    domain = [Order._webvue_visible_domain()]
    if args.get('state'):
        if args['state'] not in dict(ORDER_STATES):
            reject(f'state must be one of {[name for name, _label in ORDER_STATES]}', 'state')
        domain.append(('state', '=', args['state']))
    if args.get('channel_id'):
        domain.append(('conversation_id.channel_id', '=', parse_positive_int(args['channel_id'], 'channel_id')))
    if args.get('q'):
        domain += ['|', ('conversation_id.contact_id.name', 'ilike', args['q']), ('conversation_id.contact_id.phone', 'ilike', args['q'])]
    return domain


# The refusals of the order and payment services and their API answers: (status, code, field).
REFUSALS = {
    OrderLocked: (409, 'order_locked', None),
    WindowClosed: (409, 'window_closed', None),
    OrderLinesInvalid: (422, 'invalid', 'lines'),
    PayTemplateInvalid: (422, 'invalid', 'template_id'),
    NotInvoiceable: (422, 'not_invoiceable', None),
    NotPayable: (409, 'not_payable', None),
    NoGateway: (422, 'no_gateway', None),
    CheckoutOpen: (409, 'payment_in_progress', None),
}


def refusal(error):
    """The API error of a service refusal."""
    status, code, field = REFUSALS[type(error)]
    return ApiError(status, code, str(error), field=field)


class OrderController(http.Controller):

    @http.route('/api/v1/inbox/orders', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(READ)
    def list_orders(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        Order = request.env['webvue.inbox.order']
        domain = order_filters(args)
        status = args.get('payment_status')
        if status and status not in PAYMENT_STATUSES:
            reject(f'payment_status must be one of {PAYMENT_STATUSES}', 'payment_status')
        if args.get('channel_id') and not request.env['webvue.inbox.conversation']._webvue_count_visible(
            [('channel_id', '=', parse_positive_int(args['channel_id'], 'channel_id'))],
        ):
            return {'items': [], 'total': 0}
        if status:
            # The payment status is the payments service's fact, not a column: filter the ordered orders after reading it.
            orders = Order.search([*domain, ('state', '=', 'ordered')]).filtered(lambda order: order._webvue_payment_status() == status)
            return {'items': [dump_order(order) for order in orders[offset:offset + limit]], 'total': len(orders)}
        return {
            'items': [dump_order(order) for order in Order.search(domain, limit=limit, offset=offset)],
            'total': Order.search_count(domain),
        }

    @http.route(
        '/api/v1/inbox/conversations/<int:conversation_id>/orders', type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(READ)
    def list_conversation_orders(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        orders = request.env['webvue.inbox.order'].search([('conversation_id', '=', conversation.id)])
        return {'items': [dump_order(order) for order in orders], 'total': len(orders)}

    @http.route('/api/v1/inbox/orders/<int:order_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(READ)
    def read_order(self, order_id, **_):
        return dump_order(get_order(order_id))

    @http.route(
        '/api/v1/inbox/conversations/<int:conversation_id>/orders', type='json2', auth='user', methods=['POST'], readonly=False,
    )
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(ORDERS_MANAGE)
    def create_order(self, conversation_id, **payload):
        conversation = visible_conversation(conversation_id)
        entries = parse_order_create(payload)
        try:
            order = request.env['webvue.inbox.order']._webvue_create_for(conversation, entries)
        except tuple(REFUSALS) as error:
            raise refusal(error) from error
        return request.make_json_response(dump_order(order), status=201)

    @http.route('/api/v1/inbox/orders/<int:order_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(ORDERS_MANAGE)
    def patch_order(self, order_id, **payload):
        order = get_order(order_id)
        existing, added = parse_order_patch(payload)
        try:
            order._webvue_set_lines(existing, added)
        except tuple(REFUSALS) as error:
            raise refusal(error) from error
        return dump_order(order)

    @http.route('/api/v1/inbox/orders/<int:order_id>/checkout', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, PAYMENTS_FEATURE, operation='write')
    @requires_capability(ORDERS_MANAGE)
    def checkout_order(self, order_id, **payload):
        """Create the online order (once) and send its pay link; everything is undone when any step is refused."""
        order = get_order(order_id)
        template_id, body = parse_checkout(payload)
        template = find_one('webvue.inbox.template', template_id, 'template_id') if template_id else None
        try:
            message = order._webvue_checkout(template, body)
        except tuple(REFUSALS) as error:
            raise refusal(error) from error
        return {'order': dump_order(order), 'message_id': message.id}

    @http.route('/api/v1/inbox/orders/<int:order_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(ORDERS_MANAGE)
    def cancel_order(self, order_id, **_):
        order = get_order(order_id)
        try:
            order._webvue_cancel()
        except tuple(REFUSALS) as error:
            raise refusal(error) from error
        return dump_order(order)
