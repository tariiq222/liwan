# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_nonneg_int,
    requires_feature,
)
from odoo.addons.webvue_appointments.serializers.appointment_type import dump_types

MAX_LIMIT = 200


class AppointmentTypeController(http.Controller):

    @http.route('/api/v1/appointments/types', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    def list_types(self, **_):
        service = request.env['webvue.access.service']
        if not service._webvue_has_capability(request.env.user, 'appointments.types.read'):
            raise ApiError(403, 'forbidden', 'appointments.types.read capability is required')
        args = request.httprequest.args
        limit = min(parse_nonneg_int(args.get('limit', 50), 'limit'), MAX_LIMIT)
        offset = parse_nonneg_int(args.get('offset', 0), 'offset')
        BookingType = request.env['resource.booking.type']
        domain = [('company_id', '=', request.env.company.id)]
        booking_types = BookingType.search(domain, limit=limit, offset=offset)
        return {'items': dump_types(booking_types), 'total': BookingType.search_count(domain)}
