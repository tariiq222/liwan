# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_sales.controllers.pdf_response import pdf_response
from odoo.addons.liwan_sales.serializers.public import (
    SIGNATURE_KEYS,
    dump_public_quotation,
    parse_public_body,
    parse_reason,
    parse_signature,
)

FEATURE = 'sales.enabled'
PUBLIC = '/api/v1/public/sales/quotations/<int:order_id>'


def _answers():
    return request.env['liwan.sales.answer']


class SalesPublicController(http.Controller):
    """The customer's routes under the public namespace: no session, the access token of the quotation."""

    @http.route(PUBLIC, type='json2', auth='public', methods=['GET'], readonly=True, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_quotation(self, order_id, **_):
        order = _answers()._liwan_open(order_id, request.httprequest.args.get('access_token'))
        return dump_public_quotation(order)

    @http.route(PUBLIC + '/pdf', type='http', auth='public', methods=['GET'], readonly=True, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def quotation_pdf(self, order_id, **_):
        order = _answers()._liwan_open(order_id, request.httprequest.args.get('access_token'))
        content = request.env['liwan.sales.document']._liwan_pdf(order, signed=bool(order.signature))
        return pdf_response(order, content)

    @http.route(PUBLIC + '/accept', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def accept_quotation(self, order_id, **payload):
        token = parse_public_body(payload, SIGNATURE_KEYS)
        answers = _answers()
        order = answers._liwan_open(order_id, token)
        answers._liwan_require_answerable(order, accepting=True)
        signature = parse_signature(payload, order.liwan_answer_mode)
        return dump_public_quotation(answers._liwan_accept(order, signature))

    @http.route(PUBLIC + '/decline', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def decline_quotation(self, order_id, **payload):
        token = parse_public_body(payload, ('reason',))
        answers = _answers()
        order = answers._liwan_open(order_id, token)
        answers._liwan_require_answerable(order, accepting=False)
        return dump_public_quotation(answers._liwan_decline(order, parse_reason(payload)))
