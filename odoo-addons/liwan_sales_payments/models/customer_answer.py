# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .sale_order import confirm_or_conflict


class LiwanSalesAnswer(models.AbstractModel):
    _inherit = 'liwan.sales.answer'

    @api.model
    def _liwan_accept(self, order, signature):
        """Accept as Sales does, then confirm the order if it was paid first: a customer who paid before they signed has
        nothing left to do once they have, and the payment found the signature missing."""
        order = super()._liwan_accept(order, signature)
        confirm_or_conflict(order)
        return order
