# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanProductsService(models.AbstractModel):
    """Finance staff pick the product of a customer invoice or credit note line from the products service."""
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        return (*super()._liwan_products_feature_keys(), 'finance.enabled')

    @api.model
    def _liwan_products_pick_capabilities(self):
        """Whoever writes an invoice picks its products; reading one needs no price (a line shows its own amounts)."""
        return (*super()._liwan_products_pick_capabilities(), 'finance.invoices.manage')
