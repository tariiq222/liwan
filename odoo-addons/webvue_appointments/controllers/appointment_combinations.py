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
from odoo.addons.webvue_appointments.serializers.appointment_combination import (
    dump_combination,
    dump_combinations,
    parse_combination,
)

COMBINATION = 'resource.booking.combination'


class AppointmentCombinationController(http.Controller):

    @http.route('/api/v1/appointments/combinations', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def list_combinations(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        domain = company_domain(request.httprequest.args)
        Combination = request.env[COMBINATION]
        return {
            'items': dump_combinations(Combination.search(domain, limit=limit, offset=offset, order='name, id')),
            'total': Combination.search_count(domain),
        }

    @http.route('/api/v1/appointments/combinations/<int:combination_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def get_combination(self, combination_id, **_):
        return dump_combination(get_company_record(COMBINATION, combination_id))

    @http.route('/api/v1/appointments/combinations', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def create_combination(self, **payload):
        values = self._values(parse_combination(payload, creating=True))
        return dump_combination(request.env[COMBINATION].create({**values, 'company_id': request.env.company.id}))

    @http.route('/api/v1/appointments/combinations/<int:combination_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def patch_combination(self, combination_id, **payload):
        combination = get_company_record(COMBINATION, combination_id)
        combination.write(self._values(parse_combination(payload, creating=False)))
        return dump_combination(combination)

    @http.route('/api/v1/appointments/combinations/<int:combination_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def archive_combination(self, combination_id, **_):
        combination = get_company_record(COMBINATION, combination_id)
        combination.write({'active': False})
        return dump_combination(combination)

    @http.route('/api/v1/appointments/combinations/<int:combination_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def unarchive_combination(self, combination_id, **_):
        combination = get_company_record(COMBINATION, combination_id)
        combination.write({'active': True})
        return dump_combination(combination)

    @staticmethod
    def _values(parsed):
        values = {}
        if parsed['resource_ids'] is not None:
            resources = company_records('resource.resource', parsed['resource_ids'], 'resource_ids')
            values['resource_ids'] = [(6, 0, resources.ids)]
        if parsed['calendar'] is not None:
            calendar_id = parsed['calendar']['id']
            values['forced_calendar_id'] = (
                company_records('resource.calendar', [calendar_id], 'forced_calendar_id').id if calendar_id else False
            )
        return values
