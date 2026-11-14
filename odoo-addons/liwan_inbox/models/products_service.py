# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .constants import INBOX_FEATURE


class LiwanInboxProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        """The products routes are open to a tenant with Customer Messages."""
        return (*super()._liwan_products_feature_keys(), INBOX_FEATURE)
