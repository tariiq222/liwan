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
from odoo.addons.webvue_payments.serializers.payer import dump_payable_invoice

FEATURE = 'payments.enabled'
START_FIELDS = {'access_token', 'provider_id', 'payment_method_id'}
MAX_TOKEN_LENGTH = 128


def _invoice_for(invoice_id, token):
    """The customer invoice behind a valid access token; every other case is the same 404.

    The stock portal check returns the invoice elevated; it skips the token for a caller who may
    read the invoice anyway, so the token is always compared here too, in constant time. A missing
    invoice, a wrong token, a draft and another kind of entry are indistinguishable.
    """
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
        raise MissingError(request.env._("Record does not exist"))
    try:
        invoice = CustomerPortal()._document_check_access('account.move', invoice_id, access_token=token)
    except (MissingError, AccessError):
        raise MissingError(request.env._("Record does not exist")) from None
    if not consteq(invoice.access_token or '', token) or invoice.move_type != 'out_invoice' or invoice.state == 'draft':
        raise MissingError(request.env._("Record does not exist"))
    return invoice


class PayerController(http.Controller):
    """The anonymous payer's routes, under the public namespace: no session, a token per invoice."""

    @http.route(
        '/api/v1/public/payments/invoices/<int:invoice_id>', type='json2', auth='public', methods=['GET'],
        readonly=True, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_invoice(self, invoice_id, **_):
        invoice = _invoice_for(invoice_id, request.httprequest.args.get('access_token'))
        payer = request.env['webvue.payments.payer']
        status = payer._webvue_status(invoice)
        return dump_payable_invoice(invoice, status, payer._webvue_options(invoice) if status == 'payable' else [])

    @http.route(
        '/api/v1/public/payments/invoices/<int:invoice_id>/transactions', type='json2', auth='public',
        methods=['POST'], readonly=False, save_session=False,
    )
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def start_payment(self, invoice_id, **payload):
        unknown = set(payload) - START_FIELDS
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        invoice = _invoice_for(invoice_id, payload.get('access_token'))
        provider_id = parse_positive_int(payload.get('provider_id'), 'provider_id')
        method_id = parse_positive_int(payload.get('payment_method_id'), 'payment_method_id')
        payer = request.env['webvue.payments.payer']
        if payer._webvue_status(invoice) != 'payable':
            raise ApiError(409, 'not_payable', "this invoice does not need a payment now")
        try:
            redirect = payer._webvue_start(invoice, provider_id, method_id)
        except UserError as error:
            raise ApiError(422, 'payment_unavailable', str(error)) from error
        return {'redirect': redirect}
