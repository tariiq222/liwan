# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import QUOTATIONS_MANAGE, READ, SETTINGS_MANAGE


class LiwanSalesProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        """The products routes are open to a tenant with Sales."""
        return (*super()._liwan_products_feature_keys(), 'sales.enabled')

    @api.model
    def _liwan_products_pick_capabilities(self):
        """Whoever writes a quotation, or builds a quotation template, picks its products."""
        return (*super()._liwan_products_pick_capabilities(), QUOTATIONS_MANAGE, SETTINGS_MANAGE)

    @api.model
    def _liwan_products_price_capabilities(self):
        """Whoever reads a quotation sees the price of its lines."""
        return (*super()._liwan_products_price_capabilities(), READ)
