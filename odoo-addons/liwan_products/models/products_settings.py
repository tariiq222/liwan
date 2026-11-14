# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .access_service import PRODUCTS_SETTINGS_MANAGE
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

SHARING_MODES = ('establishment', 'branch')


class LiwanProductsSettings(models.Model):
    """The tenant's product policy: whether a new product is shared by every branch or belongs to one.

    One record per tenant database, changed only by a holder of ``products.settings.manage`` in the working company
    and in the root company. ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.products.settings'
    _description = 'LiwanOS products settings'
    # Every branch reads the same policy.
    _liwan_scope = 'tenant'

    # establishment: a new product has no company and every branch finds it; branch: it belongs to the company the
    # session works in.
    sharing = fields.Selection([(mode, mode) for mode in SHARING_MODES], required=True, default='establishment')
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'the revision is a positive number')

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/products_settings.xml``."""
        return self.env.ref('liwan_products.products_settings')

    @api.model
    def _liwan_can_manage(self):
        """Whether the caller holds ``products.settings.manage`` in the working company and in the root company: the
        settings bind every branch, so the manager of one branch only reads them."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        access = self.env['liwan.access.service']
        return all(
            access._liwan_has_capability(self.env.user, PRODUCTS_SETTINGS_MANAGE, company=company)
            for company in (self.env.company, root)
        )

    def _liwan_apply(self, values, revision):
        """Write ``values`` (``sharing``) read at ``revision``.

        403 ``forbidden`` unless ``_liwan_can_manage``; 409 ``conflict`` on a stale read; 409
        ``sharing_transfer_required`` when the sharing changes while any service product exists, archived ones
        included. A refusal changes nothing.
        """
        self.ensure_one()
        if not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'the product settings belong to the managers of the root company', status=403)
        if self.revision != revision:
            code = 'conflict'
            raise LiwanAccessRule(code, 'the product settings changed since they were read', status=409)
        if values.get('sharing', self.sharing) != self.sharing and self._liwan_product_exists():
            code = 'sharing_transfer_required'
            raise LiwanAccessRule(
                code, 'products exist: changing the sharing needs a transfer', field='sharing', status=409,
            )
        self.write({**values, 'revision': revision + 1})

    @api.model
    def _liwan_product_exists(self):
        """Whether the tenant holds any service product, archived ones and every branch's included (a boolean only).

        Elevated: the company fence hides the products of branches the root settings manager holds no grant in. The
        sharing transfer of PR 4 replaces this refusal and its read.
        """
        templates = self.env['product.template'].sudo().with_context(active_test=False)
        return bool(templates.search_count([('liwan_product', '=', True)], limit=1))
