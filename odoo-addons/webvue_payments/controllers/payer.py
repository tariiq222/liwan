# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError, MissingError, UserError
from odoo.http import request
from odoo.tools import consteq

from odoo.addons.portal.controllers.portal import CustomerPortal
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.webvue_payments.models.payer_service import CheckoutOpen
from odoo.addons.webvue_payments.serializers.payer import (
    dump_payable_invoice,
    dump_payable_order,
)

FEATURE = 'payments.enabled'
START_FIELDS = {'access_token', 'provider_id', 'payment_method_id'}
MAX_TOKEN_LENGTH = 128
INVOICE = 'account.move'
ORDER = 'sale.order'


def _document_for(model, document_id, token):
    """The payable document behind a valid access token; every other case is the same 404.

    The stock portal check returns the document elevated; it skips the token for a caller who may
    read the document anyway, so the token is always compared here too, in constant time. A
    missing document, a wrong token and a document no pay link may name (a draft invoice, a
    refund, an order not paid online) are indistinguishable.
    """
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
        raise MissingError(request.env._("Record does not exist"))
    try:
        document = CustomerPortal()._document_check_access(model, document_id, access_token=token)
    except (MissingError, AccessError):
        raise MissingError(request.env._("Record does not exist")) from None
    if not consteq(document.access_token or '', token) or not document._webvue_is_pay_document():
        raise MissingError(request.env._("Record does not exist"))
    return document


class PayerController(http.Controller):
    """The anonymous payer's routes, under the public namespace: no session, a token per document."""

    @http.route(
        '/api/v1/public/payments/invoices/<int:document_id>', type='json2', auth='public', methods=['GET'],
        readonly=True, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_invoice(self, document_id, **_):
        return self._summary(INVOICE, document_id, dump_payable_invoice)

    @http.route(
        '/api/v1/public/payments/orders/<int:document_id>', type='json2', auth='public', methods=['GET'],
        readonly=True, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_order(self, document_id, **_):
        return self._summary(ORDER, document_id, dump_payable_order)

    @http.route(
        '/api/v1/public/payments/invoices/<int:document_id>/transactions', type='json2', auth='public',
        methods=['POST'], readonly=False, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def start_invoice_payment(self, document_id, **payload):
        return self._start(INVOICE, document_id, payload)

    @http.route(
        '/api/v1/public/payments/orders/<int:document_id>/transactions', type='json2', auth='public',
        methods=['POST'], readonly=False, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def start_order_payment(self, document_id, **payload):
        return self._start(ORDER, document_id, payload)

    @staticmethod
    def _summary(model, document_id, dump):
        document = _document_for(model, document_id, request.httprequest.args.get('access_token'))
        payer = request.env['webvue.payments.payer']
        status = payer._webvue_status(document)
        return dump(document, status, payer._webvue_options(document) if status == 'payable' else [])

    @staticmethod
    def _start(model, document_id, payload):
        unknown = set(payload) - START_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        document = _document_for(model, document_id, payload.get('access_token'))
        provider_id = parse_positive_int(payload.get('provider_id'), 'provider_id')
        method_id = parse_positive_int(payload.get('payment_method_id'), 'payment_method_id')
        payer = request.env['webvue.payments.payer']
        if payer._webvue_status(document) != 'payable':
            raise ApiError(409, 'not_payable', "nothing needs to be paid now")
        try:
            redirect = payer._webvue_start(document, provider_id, method_id)
        except CheckoutOpen as error:
            raise ApiError(409, 'payment_in_progress', str(error)) from error
        except UserError as error:
            raise ApiError(422, 'payment_unavailable', str(error)) from error
        return {'redirect': redirect}
