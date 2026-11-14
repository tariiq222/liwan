# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Every CRM capability implies one of these two, so every CRM user may pick and price the products the company
# offers as packages (the list shows each package's price). Writing a product stays with the products capabilities.
PICK_CAPABILITIES = ('crm.leads.read', 'crm.settings.read')


class LiwanCrmProductsService(models.AbstractModel):
    _inherit = 'liwan.products.service'

    @api.model
    def _liwan_products_feature_keys(self):
        return (*super()._liwan_products_feature_keys(), 'crm.enabled')

    @api.model
    def _liwan_products_pick_capabilities(self):
        return (*super()._liwan_products_pick_capabilities(), *PICK_CAPABILITIES)
