# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime, time, timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    MANAGE_CAPABILITY,
    READ_CAPABILITY,
    WRITE_CAPABILITY,
    company_records,
    confirm_attendance,
    confirm_on_schedule,
    get_company_booking,
    offered_combination,
    require_combination_links,
    require_open_booking,
    slot_conflicts,
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
    within_deadline,
)
from odoo.addons.webvue_appointments.serializers.appointment_settings import (
    dump_settings,
)
from odoo.addons.webvue_appointments.serializers.payload import reject_unknown

BOOKING = 'resource.booking'
LIST_ORDER = 'start desc nulls last, id desc'


class AppointmentBookingController(http.Controller):
    """Staff booking routes over the engine's public methods.

    Scheduling writes ``start`` (and ``combination_id``) on the booking in the caller's environment:
    ``resource.booking`` takes the per-resource guard itself. A slot the engine refuses answers 409
    ``conflict``; a lost guard race (``ConcurrencyError``) propagates so Odoo replays the request. With ``requester_confirmation`` on, a booking that staff
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
        return self._detail(get_company_booking(booking_id), self._settings())

    @http.route('/api/v1/appointments/bookings', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def create_booking(self, **payload):
        settings = self._settings()
        parsed = parse_booking_create(payload, settings, datetime.now(UTC))
        booking_type = company_records('resource.booking.type', [parsed['type_id']], 'type_id')
        combination = offered_combination(booking_type, parsed['combination_id'])
        partner = self._requester(parsed, settings)
        values = {
            'type_id': booking_type.id,
            'partner_ids': [(6, 0, partner.ids)],
            **booking_values(parsed),
            **self._combination_values(combination),
        }
        if parsed['start']:
            require_combination_links(booking_type)
            values['start'] = parsed['start']
            with slot_conflicts():
                booking = request.env[BOOKING].create(values)
            confirm_on_schedule(booking)
        else:
            booking = request.env[BOOKING].create(values)
        return self._detail(booking, settings)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/schedule', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def schedule_booking(self, booking_id, **payload):
        booking = get_company_booking(booking_id)
        settings = self._settings()
        parsed = parse_booking_schedule(payload, settings, datetime.now(UTC))
        require_open_booking(booking)
        self._require_modifiable(booking, 'start')
        require_combination_links(booking.type_id)
        combination = offered_combination(booking.type_id, parsed['combination_id'])
        with slot_conflicts():
            booking.write({'start': parsed['start'], **self._combination_values(combination)})
        confirm_on_schedule(booking)
        return self._detail(booking, settings)

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/confirm', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def confirm_booking(self, booking_id, **_):
        booking = get_company_booking(booking_id)
        if booking.state != 'scheduled':
            raise ApiError(422, 'invalid', 'only a scheduled booking can be confirmed')
        confirm_attendance(booking)
        return self._detail(booking, self._settings())

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/cancel', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def cancel_booking(self, booking_id, **_):
        booking = get_company_booking(booking_id)
        require_open_booking(booking)
        self._require_modifiable(booking, None)
        booking.action_cancel()
        return self._detail(booking, self._settings())

    @http.route('/api/v1/appointments/bookings/<int:booking_id>/invitation', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(WRITE_CAPABILITY)
    def invite_booking(self, booking_id, **payload):
        """The requester's page path, with the booking's access token (made when missing).

        The answer is a path, not a URL: the browser that shows it knows the tenant's public origin.
        Sending it is not done here.
        """
        reject_unknown(payload, ())
        booking = get_company_booking(booking_id)
        require_open_booking(booking)
        return {'path': booking.get_portal_url()}

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
    def _combination_values(combination):
        """A pinned combination is kept as is (a taken slot is a conflict), so it turns auto-assign off.

        Without one the booking keeps its setting: a new booking auto-assigns, and a reschedule keeps the
        combination or auto-assignment it already has.
        """
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
    def _has_capability(key):
        return request.env['webvue.access.service']._webvue_has_capability(request.env.user, key, company=request.env.company)

    def _is_modifiable(self, booking):
        """Past the modification deadline only a manager of the current company may still modify a booking.

        The engine's own ``is_modifiable`` bypasses for ``group_manager``, which aggregates across companies.
        """
        return self._has_capability(MANAGE_CAPABILITY) or within_deadline(booking, fields.Datetime.now())

    def _require_modifiable(self, booking, field):
        if booking.meeting_id and not self._is_modifiable(booking):
            raise ApiError(422, 'invalid', 'the modification deadline of this booking has passed', field=field)

    def _detail(self, booking, settings):
        return dump_booking(
            booking,
            is_modifiable=self._is_modifiable(booking),
            sees_contact=self._has_capability(WRITE_CAPABILITY),
            national_id_hidden=settings['national_id_field'] == 'hidden',
        )
