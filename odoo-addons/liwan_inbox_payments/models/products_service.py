# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import CATALOG_MANAGE
from odoo.addons.liwan_inbox.models.access_service import READ


class LiwanInboxPaymentsProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_pick_capabilities(self):
        """Picking a product for the catalog is a catalog action, and every screen that shows a listed item's price
        (the composer's product picker, a conversation's commerce messages, a cart and its order) reads it through the
        price function as the person looking: the readers of the conversations. The ones who reply, assign, export or
        place orders hold that read capability as well."""
        return (*super()._liwan_products_pick_capabilities(), CATALOG_MANAGE, READ)
