# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

PAY_PATH = '/pay/invoice/%s'


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _compute_access_url(self):
        # Customers never open Odoo: the stock /my/invoices page is closed by the WebVue guard, so
        # every portal link of an invoice (emails, share links) opens the WebVue pay page instead.
        super()._compute_access_url()
        for move in self.filtered(lambda move: move.is_invoice()):
            move.access_url = PAY_PATH % move.id
