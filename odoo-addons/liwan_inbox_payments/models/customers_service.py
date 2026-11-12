# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .access_service import ORDERS_MANAGE


class LiwanInboxPaymentsCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """Placing an order picks the contact's customer, or creates one."""
        return (*super()._liwan_customers_pick_capabilities(), ORDERS_MANAGE)
