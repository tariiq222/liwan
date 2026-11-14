# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .product_template import PRODUCT_CREATE_MARKER, PRODUCT_MARKER, refuse

# Fields of a variant that change its service product: its own activity, template and image (stock shows
# ``image_variant_1920`` before the template's image), and the price it writes through to the template.
VARIANT_FIELDS = frozenset({'active', 'product_tmpl_id', 'lst_price', 'image_variant_1920'})


class ProductProduct(models.Model):
    _inherit = 'product.product'

    @api.model_create_multi
    def create(self, vals_list):
        """A variant of a service product is made only while the service creates or writes its template (stock
        ``_create_variant_ids`` runs then)."""
        if not self.env.is_superuser() and not self._liwan_through_service():
            template_ids = {vals['product_tmpl_id'] for vals in vals_list if vals.get('product_tmpl_id')}
            templates = self.env['product.template'].browse(template_ids)
            if any(vals.get('liwan_product') for vals in vals_list) or any(templates.mapped('liwan_product')):
                refuse(self._name, 'create', set().union(*vals_list))
        return super().create(vals_list)

    def write(self, vals):
        if (
            not self.env.is_superuser()
            and (VARIANT_FIELDS | self.env['product.template']._liwan_product_definition_fields()).intersection(vals)
            and any(self.product_tmpl_id.mapped('liwan_product'))
            and not self._liwan_templates_marked()
        ):
            refuse(self._name, 'write', vals)
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser() and any(self.product_tmpl_id.mapped('liwan_product')):
            refuse(self._name, 'unlink', {'product_tmpl_id'})
        return super().unlink()

    @api.model
    def _liwan_through_service(self):
        """Whether the service is creating a product in this transaction for the caller."""
        return self.env.uid in self.env.cr.precommit.data.get(PRODUCT_CREATE_MARKER, set())

    def _liwan_templates_marked(self):
        """Whether the service is writing the templates of every variant here (or creating one for the caller)."""
        marked_ids = self.env.cr.precommit.data.get(PRODUCT_MARKER, set())
        return self._liwan_through_service() or set(self.product_tmpl_id.ids) <= marked_ids
