# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.controllers.common import parse_bool_arg
from odoo.addons.liwan_products.models.products_service import (
    NAME_MAX,
    QUANTITY_BOUNDS,
    valid_quantity,
)
from odoo.addons.liwan_sales.models.sale_order import LINE_KINDS
from odoo.addons.liwan_sales.serializers.order import MAX_LINE_NAME, MAX_TERMS
from odoo.addons.liwan_sales.serializers.parsing import (
    invalid,
    is_id,
    parse_text,
    refuse_unknown,
)

TEMPLATE_KEYS = ('name', 'validity_days', 'terms', 'lines')
# The keys each kind of template line accepts; a template holds no price, tax or discount.
TEMPLATE_LINE_KEYS = {
    'product': ('kind', 'product_id', 'name', 'quantity'),
    'section': ('kind', 'name'),
    'note': ('kind', 'name'),
}
ALL_TEMPLATE_LINE_KEYS = set(TEMPLATE_LINE_KEYS['product'])
MAX_VALIDITY_DAYS = 3650
MAX_LINES = 500


def _dump_line(line, usable):
    """A template line: its kind, the product it names, its text and quantity; ``usable`` is whether a quotation could take
    it now. A line carries no price (the quotation prices it when it starts) and, of stock's flags, only the order."""
    product = line.product_id.product_tmpl_id
    return {
        'kind': LINE_KINDS[line.display_type],
        'product': {'id': product.id, 'name': product.name} if product else None,
        'name': line.name or '',
        'quantity': line.product_uom_qty,
        'usable': usable,
    }


def dump_template_item(template, can_manage, usable_products):
    """The template without its lines, as a list row. ``can_manage`` is whether the caller may edit or archive it;
    ``usable_products`` the ids ``liwan.sales.template._liwan_usable_product_ids`` found for the page."""
    lines = template.sale_order_template_line_ids
    products = lines.filtered(lambda line: not line.display_type)
    return {
        'id': template.id,
        'name': template.name,
        'validity_days': template.number_of_days,
        'archived': not template.active,
        'line_count': len(lines),
        'usable': all(line.product_id.product_tmpl_id.id in usable_products for line in products),
        'can_manage': can_manage,
    }


def dump_template(template, can_manage, usable_products):
    """The full template shape: the row, its terms and its lines in order."""
    return {
        **dump_template_item(template, can_manage, usable_products),
        'terms': html2plaintext(template.note).strip() if template.note else '',
        'lines': [
            _dump_line(line, bool(line.display_type) or line.product_id.product_tmpl_id.id in usable_products)
            for line in template.sale_order_template_line_ids.sorted('sequence')
        ],
    }


def parse_template_filters(args):
    """``(query, archived)`` of the list filters (``q``, ``archived``), or a 422."""
    return (args.get('q') or '').strip(), parse_bool_arg(args, 'archived')


def _parse_line(index, line):
    """A line entry ``{index, kind, product_id, name, quantity}``, or a 422 on ``lines.<index>.<key>``."""
    prefix = f'lines.{index}.'
    if not isinstance(line, dict):
        invalid(f'lines.{index}', 'a line must be an object')
    refuse_unknown(line, ALL_TEMPLATE_LINE_KEYS, prefix)
    kind = line.get('kind')
    if kind not in TEMPLATE_LINE_KEYS:
        invalid(f'{prefix}kind', f'kind must be one of {tuple(TEMPLATE_LINE_KEYS)}')
    refuse_unknown(line, TEMPLATE_LINE_KEYS[kind], prefix)
    name = line.get('name')
    # An empty name on a product line means "not given": the product's description stays.
    given = kind != 'product' or (name is not None and not (isinstance(name, str) and not name.strip()))
    entry = {'index': index, 'kind': kind, 'name': parse_text(name, f'{prefix}name', True, MAX_LINE_NAME) if given else None}
    if kind != 'product':
        return entry
    if 'product_id' not in line:
        invalid(f'{prefix}product_id', 'a product line needs product_id')
    if not is_id(line['product_id']):
        invalid(f'{prefix}product_id', 'product_id must be a positive integer')
    quantity = line.get('quantity')
    if not valid_quantity(quantity):
        invalid(f'{prefix}quantity', QUANTITY_BOUNDS)
    entry.update(product_id=line['product_id'], quantity=quantity)
    return entry


def parse_template_body(payload, creating):
    """The whitelisted values of a create (``creating``: ``name`` required) or a PATCH, or a 422 naming the field."""
    refuse_unknown(payload, TEMPLATE_KEYS)
    if creating and 'name' not in payload:
        invalid('name', 'name is required')
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload['name'], 'name', True, NAME_MAX)
    if 'validity_days' in payload:
        days = payload['validity_days']
        if not isinstance(days, int) or isinstance(days, bool) or not 0 <= days <= MAX_VALIDITY_DAYS:
            invalid('validity_days', f'validity_days must be an integer from 0 to {MAX_VALIDITY_DAYS}')
        values['validity_days'] = days
    if 'terms' in payload:
        values['terms'] = parse_text(payload['terms'], 'terms', False, MAX_TERMS)
    if 'lines' in payload:
        if not isinstance(payload['lines'], list) or len(payload['lines']) > MAX_LINES:
            invalid('lines', f'lines must be a list of at most {MAX_LINES}')
        values['lines'] = [_parse_line(index, line) for index, line in enumerate(payload['lines'])]
    if not values:
        invalid(None, 'nothing to change')
    return values
