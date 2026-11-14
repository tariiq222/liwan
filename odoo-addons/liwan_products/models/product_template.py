# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_core.models.protected_write import is_marked_write

# liwan.products.service marks the templates it writes; the caller's uid while it creates one.
PRODUCT_MARKER = 'liwan_products.product_template_ids'
PRODUCT_CREATE_MARKER = 'liwan_products.product_create'
# A product's definition in this phase: only the service writes these on a service product. Contributing addons add
# their own fields through ``_liwan_product_extension_specs``.
DEFINITION_FIELDS = frozenset({
    'name', 'type', 'list_price', 'description_sale', 'image_1920', 'active', 'company_id', 'liwan_product',
})


def refuse(model, operation, vals):
    """The stable machine-readable refusal of a product write or create outside liwan.products.service."""
    msg = 'use_liwan_products_service:%s_%s:%s' % (model.replace('.', '_'), operation, ','.join(sorted(vals)))
    raise AccessError(msg)


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    # A product created or adopted through liwan.products.service: the rows its lists, picks and writes reach. Stock
    # modules' own products (a down payment, a delivery fee) never carry it.
    liwan_product = fields.Boolean(index=True, copy=False)

    @api.model
    def _liwan_product_extension_specs(self):
        """The fields contributing addons add to a product's definition, as a list of specs (the base addon has none).

        Each spec is a dict:

        - ``name``: the wire key on the product (read and write) and in the service's ``values``;
        - ``field``: the ``product.template`` field it stores;
        - ``applies(env)``: whether the field exists for the session's establishment (the product API omits it and
          refuses it as unknown otherwise);
        - ``parse(env, value, company)``: the stored value for a wire ``value`` on a product owned by ``company``
          (empty when shared), or a ``LiwanAccessRule`` 422;
        - ``default(env, company)``: the stored value of a new product created without the field;
        - ``blank``: the ``{field: ORM value}`` the create carries, so that no stock default of the contributing
          module runs in the caller's environment (``field`` and any related default) before ``write`` stores the
          real value;
        - ``write(product, stored)``: stores a parsed or default value (the service calls it under its marker,
          after its own capability and company checks);
        - ``dump(product)``: the wire value.

        The service writes the field with ``products.manage``. An override returns ``super()`` plus its own specs.
        """
        return []

    @api.model
    def _liwan_product_definition_fields(self):
        """Every field of a service product that only the service writes."""
        return DEFINITION_FIELDS | {spec['field'] for spec in self._liwan_product_extension_specs()}

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            through_service = self.env.uid in self.env.cr.precommit.data.get(PRODUCT_CREATE_MARKER, set())
            if any(vals.get('liwan_product') for vals in vals_list) and not through_service:
                refuse(self._name, 'create', {'liwan_product'})
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            guarded = self._liwan_product_definition_fields()
            if (
                guarded.intersection(vals)
                and not is_marked_write(self, PRODUCT_MARKER, guarded, vals)
                and ('liwan_product' in vals or any(self.mapped('liwan_product')))
            ):
                refuse(self._name, 'write', vals)
        return super().write(vals)

    def unlink(self):
        """A service product is archived through the service, never deleted (only the superuser deletes one)."""
        if not self.env.is_superuser() and any(self.mapped('liwan_product')):
            refuse(self._name, 'unlink', {'liwan_product'})
        return super().unlink()
