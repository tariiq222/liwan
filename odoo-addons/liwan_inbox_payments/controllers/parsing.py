# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of the catalog bodies (packages/contracts inbox catalog schemas): every limit is checked here again."""
import base64
import binascii

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
from odoo.addons.liwan_inbox_payments.models.catalog_image import inspect_image
from odoo.addons.liwan_inbox_payments.models.constants import (
    MAX_BRAND,
    MAX_CART_QUANTITY,
    MAX_IMAGE_BYTES,
    MAX_PRODUCT_DESCRIPTION,
    MAX_PRODUCT_NAME,
    META_ID,
    MIN_IMAGE_SIDE,
    RETAILER_ID,
)

AVAILABILITY = ('in_stock', 'out_of_stock')
MAX_ORDER_LINES = 100
IMAGE_FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG'}
CATALOG_FIELDS = {'brand', 'default_link', 'prices_include_tax'}


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
    """The brand, link and tax mode given in `payload` as catalog values."""
    values = {}
    if 'brand' in payload:
        values['brand'] = parse_string(payload['brand'], 'brand', MAX_BRAND)
    if 'default_link' in payload:
        values['default_link'] = (
            parse_https_url(payload['default_link'], 'default_link', MAX_CTA_URL) if payload['default_link'] is not None else False
        )
    if 'prices_include_tax' in payload:
        values['prices_include_tax'] = parse_bool(payload['prices_include_tax'], 'prices_include_tax')
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


def parse_image(value, key):
    """(file name, bytes) of an uploaded product image: JPEG or PNG, at least 500 x 500, at most 5 MB."""
    field = f'product.{key}'
    value = parse_object(value, field, {'name', 'mimetype', 'data'}, ('name', 'mimetype', 'data'))
    name = parse_string(value['name'], field, 255)
    expected = IMAGE_FORMATS.get(value['mimetype'])
    if not expected:
        reject('the image must be a JPEG or PNG', field)
    data = value['data']
    if not isinstance(data, str) or len(data) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 8:
        reject('the image is larger than 5 MB', field)
    try:
        raw = base64.b64decode(''.join(data.split()), validate=True)
    except (binascii.Error, ValueError):
        reject('the image data must be valid base64', field)
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        reject('the image must not be empty or larger than 5 MB', field)
    info = inspect_image(raw)
    if not info or info[0] != expected:
        reject('the file is not the JPEG or PNG image it says', field)
    if min(info[1], info[2]) < MIN_IMAGE_SIDE:
        reject(f'the image must be at least {MIN_IMAGE_SIDE} x {MIN_IMAGE_SIDE} pixels', field)
    return name, raw


def parse_price(value, key):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1e9:
        reject(f'{key} must be a number from 0', key)
    return float(value)


def parse_product(value, creating):
    """The product fields of a new catalog product (every key) or of an edit (any key) as template values."""
    keys = {'name', 'description', 'list_price', 'image'}
    value = parse_object(value, 'product', keys, keys if creating else ())
    if not creating and not value:
        reject('send at least one field', 'product')
    values = {}
    if 'name' in value:
        values['name'] = parse_string(value['name'], 'product.name', MAX_PRODUCT_NAME)
    if 'description' in value:
        values['description_sale'] = parse_string(
            value['description'], 'product.description', MAX_PRODUCT_DESCRIPTION, nullable=True,
        ) or False
    if 'list_price' in value:
        values['list_price'] = parse_price(value['list_price'], 'product.list_price')
    if 'image' in value:
        values['image_1920'] = base64.b64encode(parse_image(value['image'], 'image')[1])
    return values


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
    """(template id or None, body or None) of a checkout body."""
    check_fields_or_empty(payload, {'template_id', 'body'})
    template_id = parse_positive_int(payload['template_id'], 'template_id') if 'template_id' in payload else None
    body = parse_string(payload['body'], 'body', 1024) if 'body' in payload else None
    return template_id, body


def check_fields_or_empty(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        reject(f'field {unknown[0]!r} is not accepted', unknown[0])
