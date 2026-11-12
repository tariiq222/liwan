# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .constants import INBOX_FEATURE


class LiwanInboxCustomersService(models.AbstractModel):
    _inherit = 'liwan.customers.service'

    @api.model
    def _liwan_customers_feature_keys(self):
        """The customer routes are open to a tenant with Customer Messages."""
        return (*super()._liwan_customers_feature_keys(), INBOX_FEATURE)
