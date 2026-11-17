# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The customer a ticket is about is resolved through the one customer service."""
from odoo import api, models

from .access_service import WRITE


class LiwanCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_pick_capabilities(self):
        """Whoever opens a ticket for a customer picks that customer: an agent. An employee asking for help names none."""
        return (*super()._liwan_customers_pick_capabilities(), WRITE)
