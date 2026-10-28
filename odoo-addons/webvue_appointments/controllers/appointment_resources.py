# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
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
    company_domain,
    company_records,
    get_company_record,
)
from odoo.addons.webvue_appointments.serializers.appointment_resource import (
    RESOURCE_TYPES,
    dump_resource,
    dump_resources,
    parse_resource,
)

RESOURCE = 'resource.resource'


class AppointmentResourceController(http.Controller):
    """Employee resources are owned by HR and only listed; material resources (rooms, devices) are managed here."""

    @http.route('/api/v1/appointments/resources', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('appointments.enabled', operation='read')
    @requires_capability(READ_CAPABILITY)
    def list_resources(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = company_domain(args)
        if 'type' in args:
            if args['type'] not in RESOURCE_TYPES:
                raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(RESOURCE_TYPES), field='type')
            domain.append(('resource_type', '=', args['type']))
        if args.get('q'):
            domain.append(('name', 'ilike', args['q']))
        Resource = request.env[RESOURCE]
        return {
            'items': dump_resources(Resource.search(domain, limit=limit, offset=offset, order='name, id')),
            'total': Resource.search_count(domain),
        }

    @http.route('/api/v1/appointments/resources', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def create_resource(self, **payload):
        parsed = parse_resource(payload, creating=True)
        values = {**parsed['values'], 'resource_type': 'material', 'company_id': request.env.company.id}
        values.update(self._calendar_values(parsed))
        return dump_resource(request.env[RESOURCE].create(values))

    @http.route('/api/v1/appointments/resources/<int:resource_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def patch_resource(self, resource_id, **payload):
        resource = self._material(resource_id)
        parsed = parse_resource(payload, creating=False)
        resource.write({**parsed['values'], **self._calendar_values(parsed)})
        return dump_resource(resource)

    @http.route('/api/v1/appointments/resources/<int:resource_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def archive_resource(self, resource_id, **_):
        resource = self._material(resource_id)
        # combination.resource_ids hides archived resources, so the engine would treat a combination left
        # with none of them as free at all hours.
        combinations = request.env['resource.booking.combination'].search([('resource_ids', 'in', resource.ids)])
        if combinations:
            raise ApiError(
                422, 'invalid', 'the resource is used by the combination(s): %s' % ', '.join(combinations.mapped('name')),
                field='resource_id',
            )
        resource.write({'active': False})
        return dump_resource(resource)

    @http.route('/api/v1/appointments/resources/<int:resource_id>/unarchive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('appointments.enabled', operation='write')
    @requires_capability(MANAGE_CAPABILITY)
    def unarchive_resource(self, resource_id, **_):
        resource = self._material(resource_id)
        resource.write({'active': True})
        return dump_resource(resource)

    @staticmethod
    def _material(resource_id):
        """A material resource of the current company; an employee resource belongs to HR."""
        resource = get_company_record(RESOURCE, resource_id)
        if resource.resource_type != 'material':
            raise ApiError(403, 'forbidden', 'employee resources are managed by HR')
        return resource

    @staticmethod
    def _calendar_values(parsed):
        if parsed['calendar_id'] is None:
            return {}
        return {'calendar_id': company_records('resource.calendar', [parsed['calendar_id']], 'calendar_id').id}
