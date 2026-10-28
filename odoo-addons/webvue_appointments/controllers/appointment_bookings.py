# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta

from odoo import http
from odoo.exceptions import ConcurrencyError, ValidationError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    READ_CAPABILITY,
    WRITE_CAPABILITY,
    company_records,
    get_company_booking,
)
from odoo.addons.webvue_appointments.serializers.appointment_booking import (
    booking_values,
    check_partner_contact,
    dump_booking,
    dump_booking_rows,
    parse_booking_create,
    parse_booking_query,
    parse_booking_schedule,
    requester_values,
)
from odoo.addons.webvue_appointments.serializers.appointment_settings import (
    dump_settings,
)

BOOKING = 'resource.booking'
LIST_ORDER = 'start desc nulls last, id desc'


class AppointmentBookingController(http.Controller):
    """Staff booking routes over the engine's public methods.

    Scheduling writes ``start`` (and ``combination_id``) on the booking in the caller's environment:
    ``resource.booking`` takes the per-resource guard itself. A slot the engine refuses and a lost
    guard race answer 409 ``conflict``. With ``requester_confirmation`` on, a booking that staff
    create with a start or schedule stays ``scheduled`` until ``/confirm``; with it off, staff
    scheduling confirms it at once. Every route checks its capability in the current company and
    looks the booking up inside it (the ORM write rules are company-blind).
    """

    @http.route('/api/v1/appointments/bookings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def list_bookings(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        query = parse_booking_query(args)
        domain = self._list_domain(query)
        Booking = request.env[BOOKING]
        if query['state'] == 'canceled':
            Booking = Booking.with_context(active_test=False)
        return {
            'items': dump_booking_rows(Booking.search(domain, limit=limit, offset=offset, order=LIST_ORDER)),
            'total': Booking.search_count(domain),
        }

    @http.route('/api/v1/appointments/bookings/<int:booking_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def get_booking(self, booking_id, **_):
        return dump_booking(get_company_booking(booking_id))

    @http.route('/api/v1/appointments/bookings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def create_booking(self, **payload):
        settings = self._settings()
        parsed = parse_booking_create(payload, settings, datetime.now(UTC))
        booking_type = company_records('resource.booking.type', [parsed['type_id']], 'type_id')
        combination = self._combination(booking_type, parsed['combination_id'])
        partner = self._requester(parsed, settings)
        values = {
            'type_id': booking_type.id,
            'partner_ids': [(6, 0, partner.ids)],
            **booking_values(parsed),
            **self._combination_values(combination),
        }
        if parsed['start']:
            values['start'] = parsed['start']
            with self._conflicts():
                booking = request.env[BOOKING].create(values)
            self._confirm_unless_requester_does(booking, settings)
        else:
            booking = request.env[BOOKING].create(values)
        return dump_booking(booking)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/schedule', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def schedule_booking(self, booking_id, **payload):
        booking = get_company_booking(booking_id)
        settings = self._settings()
        parsed = parse_booking_schedule(payload, settings, datetime.now(UTC))
        self._require_open(booking)
        self._require_modifiable(booking, 'start')
        combination = self._combination(booking.type_id, parsed['combination_id'])
        with self._conflicts():
            booking.write({'start': parsed['start'], **self._combination_values(combination)})
        self._confirm_unless_requester_does(booking, settings)
        return dump_booking(booking)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def confirm_booking(self, booking_id, **_):
        booking = get_company_booking(booking_id)
        if booking.state != 'scheduled':
            raise ApiError(422, 'invalid', 'only a scheduled booking can be confirmed')
        booking.action_confirm()
        return dump_booking(booking)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def cancel_booking(self, booking_id, **_):
        booking = get_company_booking(booking_id)
        self._require_open(booking)
        self._require_modifiable(booking, None)
        booking.action_cancel()
        return dump_booking(booking)

    @staticmethod
    def _settings():
        return dump_settings(request.env['webvue.appointment.settings']._webvue_current())

    @staticmethod
    def _list_domain(query):
        domain = [('type_id.company_id', '=', request.env.company.id)]
        if query['state']:
            domain.append(('state', '=', query['state']))
        if query['type_id']:
            domain.append(('type_id', '=', query['type_id']))
        if query['resource_id']:
            domain.append(('combination_id.resource_ids', 'in', [query['resource_id']]))
        if query['first']:
            domain.append(('start', '>=', datetime.combine(query['first'], time.min)))
        if query['last']:
            domain.append(('start', '<', datetime.combine(query['last'] + timedelta(days=1), time.min)))
        if query['mine']:
            user = request.env.user
            domain += ['|', ('partner_ids', 'in', user.partner_id.ids), ('combination_id.resource_ids.user_id', '=', user.id)]
        return domain

    @staticmethod
    def _combination(booking_type, combination_id):
        """The chosen combination (empty when none was sent, so the engine auto-assigns); it must belong to the type."""
        Combination = request.env['resource.booking.combination']
        if combination_id is None:
            return Combination
        if combination_id not in booking_type.combination_rel_ids.combination_id.filtered('active').ids:
            raise ApiError(422, 'invalid', 'the type does not offer this combination', field='combination_id')
        return Combination.browse(combination_id)

    @staticmethod
    def _combination_values(combination):
        """A chosen combination is kept as is (a taken slot is a conflict), so it turns auto-assign off."""
        if not combination:
            return {}
        return {'combination_id': combination.id, 'combination_auto_assign': False}

    @staticmethod
    def _requester(parsed, settings):
        """The requester partner: an existing one the caller may see in the current company, or a new one."""
        Partner = request.env['res.partner']
        if parsed['requester_id'] is None:
            return Partner.create(requester_values(parsed, request.env.company.id))
        partner = Partner.search([
            ('id', '=', parsed['requester_id']), ('company_id', 'in', [False, request.env.company.id]),
        ])
        if not partner:
            raise ApiError(422, 'invalid', 'unknown record for the current company', field='requester_id')
        check_partner_contact(partner, settings)
        return partner

    @staticmethod
    def _require_open(booking):
        if booking.state == 'canceled':
            raise ApiError(422, 'invalid', 'the booking is canceled')

    @staticmethod
    def _require_modifiable(booking, field):
        """The engine's modification deadline (its manager bypass is inside ``is_modifiable``)."""
        if booking.meeting_id and not booking.is_modifiable:
            raise ApiError(422, 'invalid', 'the modification deadline of this booking has passed', field=field)

    @staticmethod
    def _confirm_unless_requester_does(booking, settings):
        if not settings['requester_confirmation']:
            booking.action_confirm()

    @staticmethod
    @contextmanager
    def _conflicts():
        """The engine's refusal of a slot and a lost resource-guard race are both a 409."""
        try:
            yield
        except ValidationError as error:
            raise ApiError(409, 'conflict', 'the slot is not available') from error
        except ConcurrencyError as error:
            raise ApiError(409, 'conflict', 'another booking is using this resource, try again') from error
