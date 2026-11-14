# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes and request parsing of /api/v1/products."""
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_products.models.products_service import STOCK_TYPES

LIST_ARGS = frozenset({'q', 'archived', 'type', 'limit', 'offset'})


def _ref(record):
    return {'id': record.id, 'name': record.name} if record else None


def dump_price(price):
    """The amounts of the price function on the wire: the unit price as typed, then before tax, tax and total."""
    currency = price['currency']
    return {
        'unit_price': price['unit_price'],
        'amount_untaxed': price['amount_untaxed'],
        'amount_tax': price['amount_tax'],
        'amount_total': price['amount_total'],
        'currency': {'id': currency.id, 'name': currency.name, 'symbol': currency.symbol},
    }


def dump_product(service, product):
    """The detail shape of a service product, with its price for one unit in the session's company and the fields
    contributing addons add (only those that apply to the session's establishment)."""
    return {
        'id': product.id,
        'name': product.name,
        'type': STOCK_TYPES.get(product.type, product.type),
        'description': product.description_sale or None,
        'list_price': product.list_price,
        'price': dump_price(service._liwan_price(product)),
        'company': _ref(product.company_id),
        'active': product.active,
        **{name: spec['dump'](product) for name, spec in service._liwan_extension_specs().items()},
    }


def dump_products(service, products, total):
    return {'items': [dump_product(service, product) for product in products], 'total': total}


def dump_pick(service, product):
    """What a pick holder sees of a product: its id, name, type and the three amounts of one unit."""
    price = service._liwan_price(product)
    return {
        'id': product.id,
        'name': product.name,
        'type': STOCK_TYPES.get(product.type, product.type),
        **dump_price(price),
    }


def dump_picks(service, products, total):
    return {'items': [dump_pick(service, product) for product in products], 'total': total}


def parse_list_args(args):
    """``(query, archived, type)`` of a list request, or a 422."""
    unknown = sorted(set(args) - LIST_ARGS)
    if unknown:
        raise ApiError(422, 'unknown_field', f'argument {unknown[0]!r} is not accepted', field=unknown[0])
    archived = args.get('archived', 'false')
    if archived not in ('true', 'false'):
        raise ApiError(422, 'invalid', 'archived must be true or false', field='archived')
    return (args.get('q') or '').strip() or None, archived == 'true', args.get('type') or None


def parse_product_payload(payload):
    """The values of a create or edit body: an object of product fields (the service checks each)."""
    if not isinstance(payload, dict) or not payload:
        raise ApiError(422, 'invalid', 'nothing to change')
    return dict(payload)
