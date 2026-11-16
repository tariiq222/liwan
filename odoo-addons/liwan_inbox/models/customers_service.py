# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import ORDERS_MANAGE, REPLY
from .constants import INBOX_FEATURE


class LiwanInboxCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        """The customer routes are open to a tenant with Customer Messages."""
        return (*super()._liwan_customers_feature_keys(), INBOX_FEATURE)

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """A conversation agent picks, or creates, the customer of a contact from the contact panel; placing an order picks
        the contact's customer, or creates one."""
        return (*super()._liwan_customers_pick_capabilities(), REPLY, ORDERS_MANAGE)
