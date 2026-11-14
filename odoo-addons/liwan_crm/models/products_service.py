# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Whoever adds a package picks it from the products of the service. Every CRM capability implies one of the two
# read capabilities, so every CRM user sees the price of the company's packages (the list, a sale, an import) without
# browsing the products. Writing a product stays with the products capabilities.
PICK_CAPABILITIES = ('crm.settings.manage',)
PRICE_CAPABILITIES = ('crm.leads.read', 'crm.settings.read')


class LiwanCrmProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        return (*super()._liwan_products_feature_keys(), 'crm.enabled')

    @api.model
    def _liwan_products_pick_capabilities(self):
        return (*super()._liwan_products_pick_capabilities(), *PICK_CAPABILITIES)

    @api.model
    def _liwan_products_price_capabilities(self):
        return (*super()._liwan_products_price_capabilities(), *PRICE_CAPABILITIES)
