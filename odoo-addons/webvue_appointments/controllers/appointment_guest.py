# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime

from odoo import fields, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    confirm_attendance,
    confirm_on_schedule,
    require_combination_links,
    slot_conflicts,
)
from odoo.addons.webvue_appointments.serializers.appointment_guest import (
    awaits_confirmation,
    dump_guest_booking,
    is_modifiable,
    parse_guest_start,
    reject_unknown_fields,
)
from odoo.addons.webvue_appointments.serializers.appointment_settings import (
    dump_settings,
)
from odoo.addons.webvue_appointments.serializers.appointment_slot import (
    parse_type_slot_query,
    type_slot_items,
)

FEATURE = 'appointments.enabled'
TOKEN = 'access_token'
BOOKING_PATH = '/api/v1/public/appointments/bookings/<int:booking_id>'


def _guest_booking(booking_id, token):
    """The booking behind a valid access token; every other case is the same 404."""
    return request.env['webvue.appointment.guest']._webvue_booking(booking_id, token)


def _settings(booking):
    """The settings of the booking's company, read in the booking's elevated environment, with the notice raised to the type's deadline."""
    company = booking.type_id.company_id
    settings = dump_settings(booking.env['webvue.appointment.settings'].search([('company_id', '=', company.id)], limit=1))
    # A start the requester picks must stay modifiable: not closer than the type's modification deadline.
    notice = max(settings['min_notice_hours'], booking.type_id.modifications_deadline)
    return {**settings, 'min_notice_hours': notice}


def _require_modifiable(booking, now, field=None):
    if not is_modifiable(booking, now):
        raise ApiError(422, 'invalid', 'the modification deadline of this booking has passed', field=field)


class AppointmentGuestController(http.Controller):
    """The invited requester's routes, under the public namespace: no session, the booking's access token.

    The token authorizes one booking and nothing else. The engine's ``is_modifiable`` is never trusted
    here: the booking is elevated, and the engine lets an elevated caller modify past the deadline, so
    every write checks the deadline itself. Once the booking is canceled its token is gone and every
    route answers 404.
    """

    @http.route(BOOKING_PATH, type='json2', auth='public', methods=['GET'], readonly=True, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_booking(self, booking_id, **_):
        booking = _guest_booking(booking_id, request.httprequest.args.get(TOKEN))
        return dump_guest_booking(booking, _settings(booking), fields.Datetime.now())

    @http.route(BOOKING_PATH + '/slots', type='json2', auth='public', methods=['GET'], readonly=True, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def list_slots(self, booking_id, **_):
        args = request.httprequest.args
        reject_unknown_fields(args, (TOKEN, 'from', 'to'))
        booking = _guest_booking(booking_id, args.get(TOKEN))
        booking_type = booking.type_id
        if not booking_type.active:
            raise ApiError(422, 'invalid', 'the type of this booking is no longer offered')
        settings = _settings(booking)
        now = datetime.now(UTC)
        first, last, _ = parse_type_slot_query(booking_type, args, settings, now)
        pinned = booking.env['resource.booking.combination'] if booking.combination_auto_assign else booking.combination_id
        items = type_slot_items(booking_type, pinned, first, last, settings, now, origin=booking)
        return {'items': items, 'total': len(items)}

    @http.route(BOOKING_PATH + '/schedule', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def schedule_booking(self, booking_id, **payload):
        reject_unknown_fields(payload, (TOKEN, 'start'))
        booking = _guest_booking(booking_id, payload.get(TOKEN))
        if not booking.type_id.active:
            raise ApiError(422, 'invalid', 'the type of this booking is no longer offered')
        settings = _settings(booking)
        start = parse_guest_start(payload, settings, datetime.now(UTC))
        _require_modifiable(booking, fields.Datetime.now(), 'start')
        require_combination_links(booking.type_id)
        with slot_conflicts():
            booking.write({'start': start})
        confirm_on_schedule(booking)
        return dump_guest_booking(booking, settings, fields.Datetime.now())

    @http.route(BOOKING_PATH + '/confirm', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def confirm_booking(self, booking_id, **payload):
        reject_unknown_fields(payload, (TOKEN,))
        booking = _guest_booking(booking_id, payload.get(TOKEN))
        # A paying booking was confirmed when it was scheduled and is held by its order, so it waits for no confirmation.
        if not awaits_confirmation(booking):
            raise ApiError(422, 'invalid', 'this booking does not wait for your confirmation')
        _require_modifiable(booking, fields.Datetime.now())
        confirm_attendance(booking)
        return dump_guest_booking(booking, _settings(booking), fields.Datetime.now())

    @http.route(BOOKING_PATH + '/cancel', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def cancel_booking(self, booking_id, **payload):
        reject_unknown_fields(payload, (TOKEN,))
        booking = _guest_booking(booking_id, payload.get(TOKEN))
        _require_modifiable(booking, fields.Datetime.now())
        booking.action_cancel()
        return dump_guest_booking(booking, _settings(booking), fields.Datetime.now())
