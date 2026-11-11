# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .constants import MAX_CART_QUANTITY


class LiwanInboxOrderLine(models.Model):
    """One line of a cart: the catalog product (none for a retailer id this catalog does not know) and its quantity."""
    _name = 'liwan.inbox.order.line'
    _description = 'Customer Inbox order line'
    _order = 'sequence, id'
    _liwan_scope = 'company'

    order_id = fields.Many2one('liwan.inbox.order', required=True, index=True, ondelete='cascade')
    company_id = fields.Many2one(related='order_id.company_id', store=True, index=True)
    sequence = fields.Integer(default=0)
    retailer_id = fields.Char(required=True)
    catalog_item_id = fields.Many2one('liwan.inbox.catalog.item', index=True, ondelete='set null')
    product_id = fields.Many2one('product.product', ondelete='set null')
    quantity = fields.Integer(required=True, default=1)
    # What the customer's cart said (Meta's item_price); zero for a line an agent added.
    cart_price = fields.Float(digits=(16, 4))
    currency = fields.Char(required=True, size=3)
    # The line of the online order made from this one.
    sale_order_line_id = fields.Many2one('sale.order.line', index=True, ondelete='set null')

    @api.constrains('quantity')
    def _check_quantity(self):
        if any(not 1 <= line.quantity <= MAX_CART_QUANTITY for line in self):
            raise ValidationError(self.env._('A quantity is 1 to %(max)s.', max=MAX_CART_QUANTITY))

    def _liwan_unit_price(self):
        """The price the catalog shows for this line now, or None for a line without a catalog item."""
        self.ensure_one()
        return self.catalog_item_id._liwan_price() if self.catalog_item_id else None
