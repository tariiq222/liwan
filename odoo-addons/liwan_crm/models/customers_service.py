# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

WORK_CAPABILITY = 'crm.leads.work'


class LiwanCrmCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        """The customer routes are open to a tenant with CRM."""
        return (*super()._liwan_customers_feature_keys(), 'crm.enabled')

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """An agent who works leads picks, or creates, the customer of a lead when linking it or winning it."""
        return (*super()._liwan_customers_pick_capabilities(), WORK_CAPABILITY)
