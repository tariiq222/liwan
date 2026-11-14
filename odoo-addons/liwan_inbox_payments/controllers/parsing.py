# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of the catalog bodies (packages/contracts inbox catalog schemas): every limit is checked here again."""

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_inbox.controllers.helpers import check_fields, reject
from odoo.addons.liwan_inbox.controllers.reply_parsing import (
    MAX_CTA_URL,
    parse_https_url,
    parse_list,
    parse_object,
    parse_string,
)
from odoo.addons.liwan_inbox_payments.adapters import meta_catalog
from odoo.addons.liwan_inbox_payments.models.constants import (
    MAX_BRAND,
    MAX_CART_QUANTITY,
    META_ID,
    RETAILER_ID,
)

AVAILABILITY = ('in_stock', 'out_of_stock')
MAX_ORDER_LINES = 100
CATALOG_FIELDS = {'brand', 'default_link'}


def provider_failure(error):
    """422 for a Meta refusal: `provider_permission` when the token lacks a permission or the catalog asset."""
    if meta_catalog.is_permission_error(error):
        raise ApiError(
            422, 'provider_permission',
            'grant catalog_management and assign the catalog to the system user', details={'provider': str(error)},
        )
    reject(str(error))


def parse_bool(value, key):
    if not isinstance(value, bool):
        reject(f'{key} must be true or false', key)
    return value


def parse_meta_id(value, key):
    if not isinstance(value, str) or not META_ID.match(value):
        reject(f'{key} must be 5 to 32 digits', key)
    return value


def parse_catalog_fields(payload):
    """The brand and link given in `payload` as catalog values."""
    values = {}
    if 'brand' in payload:
        values['brand'] = parse_string(payload['brand'], 'brand', MAX_BRAND)
    if 'default_link' in payload:
        values['default_link'] = (
            parse_https_url(payload['default_link'], 'default_link', MAX_CTA_URL) if payload['default_link'] is not None else False
        )
    return values


def parse_catalog_create(payload):
    check_fields(payload, {'channel_id', 'meta_catalog_id', 'connect', *CATALOG_FIELDS}, required=(
        'channel_id', 'meta_catalog_id', 'connect', *CATALOG_FIELDS,
    ))
    values = parse_catalog_fields(payload)
    return (
        parse_positive_int(payload['channel_id'], 'channel_id'), parse_meta_id(payload['meta_catalog_id'], 'meta_catalog_id'),
        parse_bool(payload['connect'], 'connect'), values,
    )


def parse_catalog_patch(payload):
    check_fields(payload, CATALOG_FIELDS)
    return parse_catalog_fields(payload)


def parse_commerce_patch(payload):
    """(the flags for Meta, the paid notice values) of a channel commerce body."""
    check_fields(payload, {'cart_enabled', 'catalog_visible', 'paid_notice_enabled', 'paid_notice_text'})
    flags = {key: parse_bool(payload[key], key) for key in ('cart_enabled', 'catalog_visible') if key in payload}
    notice = {}
    if 'paid_notice_enabled' in payload:
        notice['paid_notice_enabled'] = parse_bool(payload['paid_notice_enabled'], 'paid_notice_enabled')
    if 'paid_notice_text' in payload:
        notice['paid_notice_text'] = parse_string(payload['paid_notice_text'], 'paid_notice_text', 1024)
    return flags, notice


def parse_retailer_id(value, key='product_retailer_id'):
    if not isinstance(value, str) or not RETAILER_ID.match(value):
        reject(f'{key} may contain only letters, digits, dot, underscore and dash (1 to 100)', key)
    return value


def parse_item_fields(payload):
    """The item values of the shared item fields (retailer id, availability, listed, link) given in `payload`."""
    values = {}
    if 'product_retailer_id' in payload:
        values['retailer_id'] = parse_retailer_id(payload['product_retailer_id'])
    if 'availability' in payload:
        if payload['availability'] not in AVAILABILITY:
            reject(f'availability must be one of {AVAILABILITY}', 'availability')
        values['availability'] = payload['availability']
    if 'listed' in payload:
        values['listed'] = parse_bool(payload['listed'], 'listed')
    if 'link_override' in payload:
        values['link_override'] = (
            parse_https_url(payload['link_override'], 'link_override', MAX_CTA_URL) if payload['link_override'] is not None else False
        )
    return values


ITEM_FIELDS = {'product_retailer_id', 'availability', 'listed', 'link_override'}


def parse_quantity(value, key='quantity'):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_CART_QUANTITY:
        reject(f'{key} must be a whole number from 1 to {MAX_CART_QUANTITY}', key)
    return value


def parse_order_create(payload):
    """[(catalog item id, quantity)] of an agent-built order."""
    check_fields(payload, {'lines'}, required=('lines',))
    entries = []
    for line in parse_list(payload['lines'], 'lines', 1, MAX_ORDER_LINES):
        line = parse_object(line, 'lines', {'catalog_item_id', 'quantity'}, ('catalog_item_id', 'quantity'))
        entries.append((parse_positive_int(line['catalog_item_id'], 'lines'), parse_quantity(line['quantity'], 'lines')))
    if len({item_id for item_id, _quantity in entries}) != len(entries):
        reject('a product appears once in an order', 'lines')
    return entries


def parse_order_patch(payload):
    """({line id: quantity} of the lines kept, [(catalog item id, quantity)] added) of a cart edit."""
    check_fields(payload, {'lines'}, required=('lines',))
    existing, added = {}, []
    for line in parse_list(payload['lines'], 'lines', 1, MAX_ORDER_LINES):
        line = parse_object(line, 'lines', {'id', 'catalog_item_id', 'quantity'}, ('quantity',))
        if ('id' in line) == ('catalog_item_id' in line):
            reject('a line names either an existing line id or a catalog item id', 'lines')
        quantity = parse_quantity(line['quantity'], 'lines')
        if 'id' in line:
            existing[parse_positive_int(line['id'], 'lines')] = quantity
        else:
            added.append((parse_positive_int(line['catalog_item_id'], 'lines'), quantity))
    if len({item_id for item_id, _quantity in added}) != len(added):
        reject('a product appears once in an order', 'lines')
    return existing, added


def parse_checkout(payload):
    """(template id or None, body or None, customer id or None, create_new) of a checkout body.

    ``customer_id`` names the existing customer of the contact and ``create_new`` asks for a new one; they answer a
    customer conflict and exclude each other.
    """
    check_fields_or_empty(payload, {'template_id', 'body', 'customer_id', 'create_new'})
    template_id = parse_positive_int(payload['template_id'], 'template_id') if 'template_id' in payload else None
    body = parse_string(payload['body'], 'body', 1024) if 'body' in payload else None
    customer_id = parse_positive_int(payload['customer_id'], 'customer_id') if 'customer_id' in payload else None
    create_new = parse_bool(payload['create_new'], 'create_new') if 'create_new' in payload else False
    if customer_id is not None and 'create_new' in payload:
        reject('customer_id and create_new exclude each other', 'create_new')
    return template_id, body, customer_id, create_new


def check_fields_or_empty(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        reject(f'field {unknown[0]!r} is not accepted', unknown[0])
