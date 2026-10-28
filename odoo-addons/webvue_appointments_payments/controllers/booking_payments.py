# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import UserError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    MANAGE_CAPABILITY,
    READ_CAPABILITY,
    WRITE_CAPABILITY,
    get_company_booking,
    get_company_record,
)
from odoo.addons.webvue_appointments_payments.serializers.booking_payment import (
    dump_booking_payment,
    dump_type_payment,
    parse_type_payment,
)
from odoo.addons.webvue_payments.controllers.links import payment_path

TYPE = 'resource.booking.type'


class BookingPaymentController(http.Controller):
    """How a booking type is paid online, and the payment of one booking: its state and its pay link."""

    @http.route('/api/v1/appointments/types/<int:type_id>/payment', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def get_type_payment(self, type_id, **_):
        return dump_type_payment(get_company_record(TYPE, type_id))

    @http.route('/api/v1/appointments/types/<int:type_id>/payment', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', 'payments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def patch_type_payment(self, type_id, **payload):
        booking_type = get_company_record(TYPE, type_id)
        values = parse_type_payment(payload)
        try:
            booking_type._webvue_set_payment(**values)
        except UserError as error:
            raise ApiError(422, 'invalid', str(error), field='price') from error
        return dump_type_payment(booking_type)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/payment', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def get_booking_payment(self, booking_id, **_):
        return dump_booking_payment(get_company_booking(booking_id)._webvue_payment())

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/payment/link', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', 'payments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def create_booking_payment_link(self, booking_id, **payload):
        """The pay-page path of the booking's online order, for the staff who booked it to send to the customer."""
        if payload:
            field = sorted(payload)[0]
            raise ApiError(422, 'unknown_field', f"field {field!r} is not accepted", field=field)
        booking = get_company_booking(booking_id)
        if not booking.sale_order_line_id:
            raise ApiError(409, 'not_payable', "this booking takes no online payment")
        service = request.env['webvue.payments.service']
        return {'path': payment_path(service._webvue_orders_of(booking.sale_order_line_id))}
