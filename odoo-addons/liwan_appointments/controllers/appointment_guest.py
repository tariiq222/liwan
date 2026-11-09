# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime

from odoo import fields, http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_appointments.controllers.records import (
    confirm_attendance,
    confirm_on_schedule,
    require_combination_links,
    slot_conflicts,
)
from odoo.addons.liwan_appointments.models.guest_limit import GUEST_READ_LIMIT
from odoo.addons.liwan_appointments.serializers.appointment_guest import (
    awaits_confirmation,
    dump_guest_booking,
    is_modifiable,
    parse_guest_cancel,
    parse_guest_start,
    reject_unknown_fields,
)
from odoo.addons.liwan_appointments.serializers.appointment_settings import (
    dump_settings,
)
from odoo.addons.liwan_appointments.serializers.appointment_slot import (
    MAX_SLOT_WINDOW_DAYS,
    PUBLIC_DEFAULT_WINDOW_DAYS,
    parse_type_slot_query,
    require_slot_alignment,
    type_slot_items,
)

FEATURE = 'appointments.enabled'
TOKEN = 'access_token'
BOOKING_PATH = '/api/v1/public/appointments/bookings/<int:booking_id>'


def _guest_booking(booking_id, token):
    """The booking behind a valid access token, after its per-token read budget is charged; every other case is the
    same 404 (or 429 while the token is over budget)."""
    booking = request.env['liwan.appointment.guest']._liwan_booking(booking_id, token)
    _charge_token(booking)
    return booking


def _charge_token(booking):
    """Count this request against the booking's own minute budget: one leaked token cannot walk the company's calendar
    from many addresses, and the address-counting edge limit cannot see that.

    The counter is written in the booking's own elevated environment, which the token check already opened: the public
    user holds no ACL on it."""
    reads = booking.env['liwan.appointment.guest.limit']._liwan_count_read(booking, fields.Datetime.now())
    if reads > GUEST_READ_LIMIT:
        raise ApiError(429, 'rate_limited', 'too many requests for this link; wait a minute')


def _settings(booking):
    """The settings of the booking's company, read in the booking's elevated environment, with the notice raised to the type's deadline."""
    company = booking.type_id.company_id
    settings = dump_settings(booking.env['liwan.appointment.settings'].search([('company_id', '=', company.id)], limit=1))
    # A start the requester picks must stay modifiable: not closer than the type's modification deadline.
    notice = max(settings['min_notice_hours'], booking.type_id.modifications_deadline)
    return {**settings, 'min_notice_hours': notice}


def _cancel_reasons(booking):
    """The company's active cancel reasons, ordered as the settings page lists them."""
    reasons = booking.env['liwan.appointment.reason'].search([
        ('company_id', '=', booking.type_id.company_id.id), ('kind', '=', 'cancel'), ('active', '=', True),
    ])
    return [{'id': reason.id, 'name': reason.name} for reason in reasons]


def _require_modifiable(booking, now, field=None):
    if not is_modifiable(booking, now):
        raise ApiError(422, 'invalid', 'the modification deadline of this booking has passed', field=field)


class AppointmentGuestController(http.Controller):
    """The invited requester's routes, under the public namespace: no session, the booking's access token.

    The token authorizes one booking and nothing else. The engine's ``is_modifiable`` is never trusted
    here: the booking is elevated, and the engine lets an elevated caller modify past the deadline, so
    every write checks the deadline itself. Once the booking is canceled its token is gone and every
    route answers 404. Past the company's link validity the token stops working too, so a link that leaked
    into a screenshot or an archived mail no longer shows the requester's contact details.

    The GET routes are not ``readonly``: each charges the booking's per-token read budget, which is a write.
    """

    @http.route(BOOKING_PATH, type='json2', auth='public', methods=['GET'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='read')
    def get_booking(self, booking_id, **_):
        booking = _guest_booking(booking_id, request.httprequest.args.get(TOKEN))
        return dump_guest_booking(booking, _settings(booking), _cancel_reasons(booking), fields.Datetime.now())

    @http.route(BOOKING_PATH + '/slots', type='json2', auth='public', methods=['GET'], readonly=False, save_session=False)
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
        first, last, _ = parse_type_slot_query(
            booking_type, args, settings, now,
            max_window_days=MAX_SLOT_WINDOW_DAYS, default_window_days=PUBLIC_DEFAULT_WINDOW_DAYS,
        )
        pinned = booking.env['resource.booking.combination'] if booking.combination_auto_assign else booking.combination_id
        items, next_date = type_slot_items(booking_type, pinned, first, last, settings, now, origin=booking)
        return {'items': items, 'total': len(items), 'next_date': next_date.isoformat() if next_date else None}

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
        require_slot_alignment(start, booking.type_id)
        require_combination_links(booking.type_id)
        with slot_conflicts():
            booking.write({'start': start})
        confirm_on_schedule(booking)
        return dump_guest_booking(booking, settings, _cancel_reasons(booking), fields.Datetime.now())

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
        return dump_guest_booking(booking, _settings(booking), _cancel_reasons(booking), fields.Datetime.now())

    @http.route(BOOKING_PATH + '/cancel', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature(FEATURE, operation='write')
    def cancel_booking(self, booking_id, **payload):
        reject_unknown_fields(payload, (TOKEN, 'reason_id'))
        booking = _guest_booking(booking_id, payload.get(TOKEN))
        settings = _settings(booking)
        parsed = parse_guest_cancel(payload, settings)
        _require_modifiable(booking, fields.Datetime.now())
        if parsed['reason_id'] is not None:
            reason = booking.env['liwan.appointment.reason'].search([
                ('id', '=', parsed['reason_id']), ('kind', '=', 'cancel'),
                ('company_id', '=', booking.type_id.company_id.id), ('active', '=', True),
            ])
            if not reason:
                raise ApiError(422, 'invalid', 'unknown cancel reason for this company', field='reason_id')
            booking.write({'liwan_cancel_reason_id': reason.id})
        booking.action_cancel()
        return dump_guest_booking(booking, settings, _cancel_reasons(booking), fields.Datetime.now())
