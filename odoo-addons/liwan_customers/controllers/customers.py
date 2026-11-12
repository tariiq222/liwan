# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_customers.models.access_service import (
    CUSTOMERS_MANAGE,
    CUSTOMERS_READ,
)
from odoo.addons.liwan_customers.serializers.customer import (
    dump_customer,
    dump_customers,
    parse_customer_create,
    parse_customer_patch,
)

SERVICE = 'liwan.customers.service'
FEATURE_HOOK = '_liwan_customers_feature_keys'
FEATURE_KEYS = ('registry:liwan.customers.service',)
TRUE_VALUES = ('1', 'true')


class CustomersController(http.Controller):
    """The customer directory and the candidate search. Every write goes through liwan.customers.service."""

    @http.route('/api/v1/customers/candidates', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    def list_candidates(self, **_):
        """The parties with a phone, for a holder of customers.read or of a registered pick capability: their name
        and the last four digits of the phone, nothing else."""
        service = request.env['liwan.customers.service']
        service._liwan_require_pick()
        phone = request.httprequest.args.get('phone')
        if not phone:
            raise ApiError(422, 'invalid_phone', 'phone is required', field='phone')
        found = service._liwan_candidates(phone)
        return {'items': [service._liwan_candidate_ref(partner) for partner in found], 'total': len(found)}

    @http.route('/api/v1/customers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_READ)
    def list_customers(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        archived = args.get('archived', 'false').lower() in TRUE_VALUES
        partners, total = request.env['liwan.customers.service']._liwan_search(
            args.get('q') or None, archived=archived, limit=limit, offset=offset,
        )
        return dump_customers(partners, total)

    @http.route('/api/v1/customers/<int:customer_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(CUSTOMERS_READ)
    def get_customer(self, customer_id, **_):
        return dump_customer(request.env['liwan.customers.service']._liwan_customer(customer_id, include_archived=True))

    @http.route('/api/v1/customers', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_MANAGE)
    def create_customer(self, **payload):
        values, create_new = parse_customer_create(payload)
        customer = request.env['liwan.customers.service']._liwan_resolve(values=values, create_new=create_new)
        return request.make_json_response(dump_customer(customer), status=201)

    @http.route('/api/v1/customers/<int:customer_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_MANAGE)
    def update_customer(self, customer_id, **payload):
        service = request.env['liwan.customers.service']
        customer = service._liwan_customer(customer_id, include_archived=True)
        return dump_customer(service._liwan_update(customer, parse_customer_patch(payload)))

    @http.route('/api/v1/customers/<int:customer_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_MANAGE)
    def archive_customer(self, customer_id, **_):
        service = request.env['liwan.customers.service']
        return dump_customer(service._liwan_archive(service._liwan_customer(customer_id)))

    @http.route('/api/v1/customers/<int:customer_id>/restore', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(CUSTOMERS_MANAGE)
    def restore_customer(self, customer_id, **_):
        service = request.env['liwan.customers.service']
        return dump_customer(service._liwan_restore(service._liwan_customer(customer_id, include_archived=True)))
