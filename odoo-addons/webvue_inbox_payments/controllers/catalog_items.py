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
from odoo.addons.webvue_inbox.controllers.helpers import (
    check_fields,
    find_one,
    no_content,
    not_found,
    reject,
    visible_conversation,
)
from odoo.addons.webvue_inbox.models.access_service import REPLY
from odoo.addons.webvue_inbox_payments.controllers.catalogs import get_catalog
from odoo.addons.webvue_inbox_payments.controllers.parsing import (
    ITEM_FIELDS,
    parse_item_fields,
    parse_product,
)
from odoo.addons.webvue_inbox_payments.models.access_service import CATALOG_MANAGE
from odoo.addons.webvue_inbox_payments.models.catalog_item import (
    REVIEW_STATUSES,
    SYNC_STATES,
)
from odoo.addons.webvue_inbox_payments.models.constants import CATALOG_FEATURE
from odoo.addons.webvue_inbox_payments.serializers.catalog import (
    dump_item,
    dump_pick_item,
)

CREATE_FIELDS = {'product_id', 'product', *ITEM_FIELDS}
PATCH_FIELDS = {'product', *ITEM_FIELDS}


def get_item(item_id):
    item = request.env['webvue.inbox.catalog.item'].search([('id', '=', item_id)], limit=1)
    if not item:
        raise not_found()
    get_catalog(item.catalog_id.id)  # the same 404 when the caller manages no catalog of the item's company
    return item


def item_filters(args, catalog):
    """The list filters of the query string (q, sync_state, review_status, listed)."""
    domain = [('catalog_id', '=', catalog.id)]
    if args.get('q'):
        domain += ['|', ('retailer_id', 'ilike', args['q']), ('product_id.name', 'ilike', args['q'])]
    for key, choices in (('sync_state', SYNC_STATES), ('review_status', REVIEW_STATUSES)):
        if args.get(key):
            if args[key] not in dict(choices):
                reject(f'{key} must be one of {[name for name, _label in choices]}', key)
            domain.append((key, '=', args[key]))
    if args.get('listed'):
        if args['listed'] not in ('true', 'false'):
            reject('listed must be true or false', 'listed')
        domain.append(('listed', '=', args['listed'] == 'true'))
    return domain


def new_product(catalog, values):
    """A product made for the catalog, in the catalog's company: only the catalog editor edits it afterwards."""
    template = request.env['product.template'].create({
        'type': 'consu', 'sale_ok': True, 'purchase_ok': False, 'webvue_inbox_catalog': True,
        'company_id': catalog.company_id.id, **values,
    })
    return template.product_variant_id


class CatalogItemController(http.Controller):

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>/items', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(CATALOG_MANAGE)
    def list_items(self, catalog_id, **_):
        catalog = get_catalog(catalog_id)
        limit, offset = parse_page(request.httprequest.args)
        Item = request.env['webvue.inbox.catalog.item']
        domain = item_filters(request.httprequest.args, catalog)
        return {
            'items': [dump_item(item) for item in Item.search(domain, limit=limit, offset=offset)],
            'total': Item.search_count(domain),
        }

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>/items', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def create_item(self, catalog_id, **payload):
        catalog = get_catalog(catalog_id)
        check_fields(payload, CREATE_FIELDS)
        if ('product_id' in payload) == ('product' in payload):
            reject('send either product_id or product', 'product_id')
        Item = request.env['webvue.inbox.catalog.item']
        values = parse_item_fields(payload)
        if 'product_id' in payload:
            product = find_one('product.product', payload['product_id'], 'product_id')
            if product.company_id and product.company_id != catalog.company_id:
                reject('this product belongs to another company', 'product_id')
            problem = Item._webvue_check_product_image(product)
            if problem:
                reject(problem, 'product_id')
        else:
            product = new_product(catalog, parse_product(payload['product'], creating=True))
        taken = Item.with_context(active_test=False)
        if taken.search_count([('catalog_id', '=', catalog.id), ('product_id', '=', product.id)]):
            reject('this product is already in the catalog', 'product_id')
        retailer_id = values.pop('retailer_id', None) or Item._webvue_default_retailer_id(catalog, product)
        if taken.search_count([('catalog_id', '=', catalog.id), ('retailer_id', '=', retailer_id)]):
            reject('this product id is already used in the catalog', 'product_retailer_id')
        item = Item.create({'catalog_id': catalog.id, 'product_id': product.id, 'retailer_id': retailer_id, **values})
        return request.make_json_response(dump_item(item), status=201)

    @http.route('/api/v1/inbox/catalogs/<int:catalog_id>/products', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(CATALOG_MANAGE)
    def list_products(self, catalog_id, **_):
        """The saleable products of the catalog's company that can be listed, with whether each has an image and is listed."""
        catalog = get_catalog(catalog_id)
        limit, offset = parse_page(request.httprequest.args)
        Product = request.env['product.product']
        domain = [('sale_ok', '=', True), ('company_id', 'in', [False, catalog.company_id.id])]
        if request.httprequest.args.get('q'):
            query = request.httprequest.args['q']
            domain += ['|', ('name', 'ilike', query), ('default_code', 'ilike', query)]
        listed = set(catalog.with_context(active_test=False).item_ids.product_id.ids)
        currency = catalog.company_id.currency_id.name
        return {
            'items': [{
                'id': product.id, 'name': product.with_context(display_default_code=False).display_name,
                'list_price': product.lst_price, 'currency': currency, 'has_image': bool(product.image_1024),
                'listed': product.id in listed,
            } for product in Product.search(domain, order='name, id', limit=limit, offset=offset)],
            'total': Product.search_count(domain),
        }

    @http.route('/api/v1/inbox/catalog-items/<int:item_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(CATALOG_MANAGE)
    def read_item(self, item_id, **_):
        return dump_item(get_item(item_id))

    @http.route('/api/v1/inbox/catalog-items/<int:item_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def patch_item(self, item_id, **payload):
        item = get_item(item_id)
        check_fields(payload, PATCH_FIELDS)
        values = parse_item_fields(payload)
        if 'retailer_id' in values and values['retailer_id'] != item.retailer_id and item._webvue_retailer_locked():
            reject('the product id cannot change once the product was sent to Meta', 'product_retailer_id')
        if values.get('retailer_id') and values['retailer_id'] != item.retailer_id and request.env['webvue.inbox.catalog.item'].with_context(
            active_test=False,
        ).search_count([('catalog_id', '=', item.catalog_id.id), ('retailer_id', '=', values['retailer_id'])]):
            reject('this product id is already used in the catalog', 'product_retailer_id')
        if 'product' in payload:
            template = item.product_id.product_tmpl_id
            if not template.webvue_inbox_catalog:
                reject('only a product made in the catalog can be edited here', 'product')
            template.write(parse_product(payload['product'], creating=False))
        if values:
            item.write(values)
        return dump_item(item)

    @http.route('/api/v1/inbox/catalog-items/<int:item_id>', type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='write')
    @requires_capability(CATALOG_MANAGE)
    def delete_item(self, item_id, **_):
        get_item(item_id)._webvue_delete()
        return no_content()

    @http.route(
        '/api/v1/inbox/conversations/<int:conversation_id>/catalog-items', type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('inbox.enabled', CATALOG_FEATURE, operation='read')
    @requires_capability(REPLY)
    def pick_items(self, conversation_id, **_):
        """What the composer's product picker lists: the listed, synced, not rejected items of the conversation's catalog."""
        conversation = visible_conversation(conversation_id)
        catalog = conversation.channel_id._webvue_catalog()
        if not catalog:
            raise ApiError(409, 'no_catalog', 'no catalog is connected to this conversation channel')
        limit, offset = parse_page(request.httprequest.args)
        domain = [
            ('catalog_id', '=', catalog.id), ('listed', '=', True), ('sync_state', '=', 'synced'), ('review_status', '!=', 'rejected'),
        ]
        if request.httprequest.args.get('q'):
            query = request.httprequest.args['q']
            domain += ['|', ('retailer_id', 'ilike', query), ('product_id.name', 'ilike', query)]
        Item = request.env['webvue.inbox.catalog.item']
        return {
            'items': [dump_pick_item(item) for item in Item.search(domain, limit=limit, offset=offset)],
            'total': Item.search_count(domain),
        }
