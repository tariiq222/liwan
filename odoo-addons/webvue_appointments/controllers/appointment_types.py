# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_appointments.controllers.records import (
    MANAGE_CAPABILITY,
    READ_CAPABILITY,
    company_domain,
    company_records,
    get_company_record,
)
from odoo.addons.webvue_appointments.serializers.appointment_type import (
    dump_type,
    dump_types,
    parse_type,
)

TYPE = 'resource.booking.type'


class AppointmentTypeController(http.Controller):

    @http.route('/api/v1/appointments/types', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def list_types(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        domain = company_domain(request.httprequest.args)
        BookingType = request.env[TYPE]
        return {
            'items': dump_types(BookingType.search(domain, limit=limit, offset=offset)),
            'total': BookingType.search_count(domain),
        }

    @http.route('/api/v1/appointments/types/<int:type_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def get_type(self, type_id, **_):
        return dump_type(get_company_record(TYPE, type_id))

    @http.route('/api/v1/appointments/types', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def create_type(self, **payload):
        parsed = parse_type(payload, creating=True)
        values = {**parsed['values'], 'company_id': request.env.company.id}
        values.update(self._calendar_values(parsed))
        booking_type = request.env[TYPE].create(values)
        if parsed['combination_ids']:
            combinations = company_records('resource.booking.combination', parsed['combination_ids'], 'combination_ids')
            booking_type.write({'combination_rel_ids': booking_type._webvue_combination_commands(combinations)})
        return dump_type(booking_type)

    @http.route('/api/v1/appointments/types/<int:type_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def patch_type(self, type_id, **payload):
        booking_type = get_company_record(TYPE, type_id)
        parsed = parse_type(payload, creating=False)
        values = {**parsed['values'], **self._calendar_values(parsed)}
        if parsed['combination_ids'] is not None:
            combinations = company_records('resource.booking.combination', parsed['combination_ids'], 'combination_ids')
            values['combination_rel_ids'] = booking_type._webvue_combination_commands(combinations)
        booking_type.write(values)
        return dump_type(booking_type)

    @http.route('/api/v1/appointments/types/<int:type_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def archive_type(self, type_id, **_):
        booking_type = get_company_record(TYPE, type_id)
        booking_type.write({'active': False})
        return dump_type(booking_type)

    @http.route('/api/v1/appointments/types/<int:type_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def unarchive_type(self, type_id, **_):
        booking_type = get_company_record(TYPE, type_id)
        booking_type.write({'active': True})
        return dump_type(booking_type)

    @staticmethod
    def _calendar_values(parsed):
        if parsed['calendar_id'] is None:
            return {}
        calendar = company_records('resource.calendar', [parsed['calendar_id']], 'resource_calendar_id')
        return {'resource_calendar_id': calendar.id}
