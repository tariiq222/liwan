# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

# The product fields that change what Meta shows; a change resyncs the product's catalog items.
WATCHED = frozenset({
    'name', 'list_price', 'lst_price', 'price_extra', 'description_sale', 'default_code', 'active', 'taxes_id',
    'image_1920', 'image_variant_1920',
})
IMAGE_FIELDS = frozenset({'image_1920', 'image_variant_1920'})


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    # Set on products made by the catalog editor: it edits only those.
    liwan_inbox_catalog = fields.Boolean(copy=False)

    def write(self, vals):
        result = super().write(vals)
        if WATCHED & set(vals):
            self.env['liwan.inbox.catalog.item']._liwan_product_changed(
                self.with_context(active_test=False).product_variant_ids.ids, bool(IMAGE_FIELDS & set(vals)),
            )
        return result


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def write(self, vals):
        result = super().write(vals)
        if WATCHED & set(vals):
            self.env['liwan.inbox.catalog.item']._liwan_product_changed(self.ids, bool(IMAGE_FIELDS & set(vals)))
        return result
