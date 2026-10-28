# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_payments.models.access_service import LINKS_MANAGE

FEATURE = 'payments.enabled'


class PaymentLinkController(http.Controller):

    @http.route('/api/v1/payments/links', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(LINKS_MANAGE)
    def create_link(self, **payload):
        """The pay-page path of a customer invoice the caller can read.

        The answer is a path, not a URL: the browser that shows it knows the tenant's public
        origin, which the server cannot always tell behind the edge.
        """
        unknown = set(payload) - {'invoice_id'}
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        invoice = get_record('account.move', parse_positive_int(payload.get('invoice_id'), 'invoice_id'))
        if invoice.move_type != 'out_invoice':
            raise ApiError(422, 'invalid', "only a customer invoice can be paid by link", field='invoice_id')
        if not invoice._has_to_be_paid():
            raise ApiError(409, 'not_payable', "this invoice does not need a payment now")
        if not request.env['webvue.payments.payer']._webvue_options(invoice):
            raise ApiError(422, 'no_gateway', "switch a payment gateway to live first")
        invoice._portal_ensure_token()
        return {'path': invoice.get_portal_url()}
