# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime, time, timedelta

import pytz

from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    WRITE_CAPABILITY,
    get_company_record,
    offered_combination,
)
from odoo.addons.webvue_appointments.serializers.appointment_settings import (
    dump_settings,
)
from odoo.addons.webvue_appointments.serializers.appointment_slot import (
    dump_slot,
    parse_slot_query,
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
        settings = dump_settings(request.env['webvue.appointment.settings']._webvue_current())
        tz = pytz.timezone(booking_type.resource_calendar_id.tz or 'UTC')
        now = datetime.now(UTC)
        first, last, combination_id = parse_slot_query(
            request.httprequest.args, now.astimezone(tz).date(), settings['horizon_days'],
        )
        combination = offered_combination(booking_type, combination_id)
        # The engine's public slot search on an unsaved booking, anchored to the type's calendar days.
        booking = request.env['resource.booking'].new({
            'type_id': booking_type.id, 'combination_id': combination.id or False,
        })
        slots = booking._get_available_slots(
            tz.localize(datetime.combine(first, time.min)),
            tz.localize(datetime.combine(last + timedelta(days=1), time.min)),
        )
        # The same bounds parse_start applies on create and schedule, so every listed slot is bookable.
        earliest = now + timedelta(hours=settings['min_notice_hours'])
        latest = now + timedelta(days=settings['horizon_days'])
        duration = timedelta(hours=booking.duration)
        starts = sorted(start.astimezone(UTC) for day_slots in slots.values() for start in day_slots)
        items = [dump_slot(start, start + duration) for start in starts if earliest <= start <= latest]
        return {'items': items, 'total': len(items)}
