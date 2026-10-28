# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_feature,
)
from odoo.addons.webvue_appointments.serializers.appointment_type import dump_types


class AppointmentTypeController(http.Controller):

    @http.route('/api/v1/appointments/types', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    def list_types(self, **_):
        service = request.env['webvue.access.service']
        if not service._webvue_has_capability(request.env.user, 'appointments.bookings.read'):
            raise ApiError(403, 'forbidden', 'appointments.bookings.read capability is required')
        limit, offset = parse_page(request.httprequest.args)
        BookingType = request.env['resource.booking.type']
        domain = [('company_id', '=', request.env.company.id)]
        booking_types = BookingType.search(domain, limit=limit, offset=offset)
        return {'items': dump_types(booking_types), 'total': BookingType.search_count(domain)}
