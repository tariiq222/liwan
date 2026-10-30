# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    get_record,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_payments.models.access_service import LINKS_MANAGE
from odoo.addons.liwan_payments.models.order_service import (
    NoGateway,
    NotInvoiceable,
    NotPayable,
)

FEATURE = 'payments.enabled'


def payment_path(document):
    """The pay-page path of an authorized document, with the service refusals as API errors."""
    try:
        return request.env['liwan.payments.service']._liwan_payment_path(document)
    except NotInvoiceable as error:
        raise ApiError(422, 'not_invoiceable', str(error)) from error
    except NotPayable as error:
        raise ApiError(409, 'not_payable', str(error)) from error
    except NoGateway as error:
        raise ApiError(422, 'no_gateway', str(error)) from error


class PaymentLinkController(http.Controller):

    @http.route('/api/v1/payments/links', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    @requires_capability(LINKS_MANAGE)
    def create_link(self, **payload):
        """The pay-page path of a customer invoice the caller can read."""
        unknown = set(payload) - {'invoice_id'}
        if unknown:
            field = sorted(unknown)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        invoice = get_record('account.move', parse_positive_int(payload.get('invoice_id'), 'invoice_id'))
        if invoice.move_type != 'out_invoice':
            raise ApiError(422, 'invalid', "only a customer invoice can be paid by link", field='invoice_id')
        return {'path': payment_path(invoice)}
