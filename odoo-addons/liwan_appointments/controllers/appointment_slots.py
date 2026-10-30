# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime

from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_appointments.controllers.records import (
    WRITE_CAPABILITY,
    get_company_record,
    offered_combination,
)
from odoo.addons.liwan_appointments.serializers.appointment_settings import (
    dump_settings,
)
from odoo.addons.liwan_appointments.serializers.appointment_slot import (
    parse_type_slot_query,
    type_slot_items,
)


class AppointmentSlotController(http.Controller):
    """Slots need the write capability: the engine's conflict check reads other bookings as the caller,
    and the read rule shows only the caller's own, so a read-only caller would see booked slots as free."""

    @http.route('/api/v1/appointments/types/<int:type_id>/slots', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(WRITE_CAPABILITY)
    def list_slots(self, type_id, **_):
        booking_type = get_company_record('resource.booking.type', type_id)
        if not booking_type.active:
            raise ApiError(422, 'invalid', 'an archived type has no slots', field='type_id')
        settings = dump_settings(request.env['liwan.appointment.settings']._liwan_current())
        now = datetime.now(UTC)
        first, last, combination_id = parse_type_slot_query(booking_type, request.httprequest.args, settings, now)
        combination = offered_combination(booking_type, combination_id)
        items = type_slot_items(booking_type, combination, first, last, settings, now, honour_deadline=False)
        return {'items': items, 'total': len(items)}
