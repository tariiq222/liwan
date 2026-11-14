# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import QUOTATIONS_MANAGE


class LiwanSalesCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        """The customer pick route is open to a tenant with Sales."""
        return (*super()._liwan_customers_feature_keys(), 'sales.enabled')

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """Whoever writes a quotation picks its customer."""
        return (*super()._liwan_customers_pick_capabilities(), QUOTATIONS_MANAGE)
