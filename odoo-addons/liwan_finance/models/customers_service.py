# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class LiwanCustomersService(models.AbstractModel):
    """Finance staff pick the customer or vendor of an invoice, a payment or an entry from the customers service."""
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        return (*super()._liwan_customers_feature_keys(), 'finance.enabled')

    @api.model
    def _liwan_customers_pick_capabilities(self):
        return (*super()._liwan_customers_pick_capabilities(), 'finance.partners.read', 'finance.partners.manage')
