# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_registered_feature,
)
from odoo.addons.liwan_products.models.access_service import (
    PRODUCTS_MANAGE,
    PRODUCTS_PRICES_MANAGE,
    PRODUCTS_READ,
)
from odoo.addons.liwan_products.serializers.product import (
    dump_picks,
    dump_product,
    dump_products,
    parse_list_args,
    parse_product_payload,
)

SERVICE = 'liwan.products.service'
FEATURE_HOOK = '_liwan_products_feature_keys'
FEATURE_KEYS = ('registry:liwan.products.service',)


def _service():
    return request.env[SERVICE]


class ProductsController(http.Controller):
    """The tenant's products. Every write goes through liwan.products.service, which checks the capabilities and the
    company that manages the product (D23) itself."""

    @http.route('/api/v1/products/pick', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    def pick_products(self, **_):
        """The active products, for a holder of products.read or of a registered pick capability: id, name, type and
        the amounts of one unit, nothing else."""
        service = _service()
        # tools/route_gate_policy.py needs a top-level gate call; _liwan_pick_search checks again for direct callers.
        service._liwan_require_pick()
        args = request.httprequest.args
        limit, offset = parse_page(args)
        query = (args.get('q') or '').strip() or None
        products, total = service._liwan_pick_search(query, limit=limit, offset=offset)
        return dump_picks(service, products, total)

    @http.route('/api/v1/products', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(PRODUCTS_READ)
    def list_products(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        query, archived, product_type = parse_list_args(args)
        products, total = _service()._liwan_search(
            query, archived=archived, type=product_type, limit=limit, offset=offset,
        )
        return dump_products(_service(), products, total)

    @http.route('/api/v1/products/<int:product_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='read', match='any')
    @requires_capability(PRODUCTS_READ)
    def get_product(self, product_id, **_):
        return dump_product(_service(), _service()._liwan_product(product_id, include_archived=True))

    @http.route('/api/v1/products', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(PRODUCTS_MANAGE)
    def create_product(self, **payload):
        product = _service()._liwan_create(parse_product_payload(payload))
        return request.make_json_response(dump_product(_service(), product), status=201)

    @http.route('/api/v1/products/<int:product_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(PRODUCTS_MANAGE, PRODUCTS_PRICES_MANAGE, match='any')
    def update_product(self, product_id, **payload):
        values = parse_product_payload(payload)
        product = _service()._liwan_product(product_id, include_archived=True)
        return dump_product(_service(), _service()._liwan_update(product, values))

    @http.route('/api/v1/products/<int:product_id>/archive', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(PRODUCTS_MANAGE)
    def archive_product(self, product_id, **_):
        return dump_product(_service(), _service()._liwan_archive(_service()._liwan_product(product_id)))

    @http.route('/api/v1/products/<int:product_id>/restore', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_registered_feature(SERVICE, FEATURE_HOOK, keys=FEATURE_KEYS, operation='write', match='any')
    @requires_capability(PRODUCTS_MANAGE)
    def restore_product(self, product_id, **_):
        product = _service()._liwan_product(product_id, include_archived=True)
        return dump_product(_service(), _service()._liwan_restore(product))
