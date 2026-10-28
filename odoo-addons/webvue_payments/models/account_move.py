# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, models

PAY_PATH = '/pay/invoice/%s'
PAID_STATES = ('paid', 'in_payment')


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _compute_access_url(self):
        # Customers never open Odoo: the stock /my/invoices page is closed by the WebVue guard, so
        # every portal link of a customer invoice (emails, share links) opens the WebVue pay page.
        super()._compute_access_url()
        for move in self.filtered(lambda move: move.move_type == 'out_invoice'):
            move.access_url = PAY_PATH % move.id

    # A payable document of webvue.payments.payer, like an online sale.order.

    def _webvue_is_pay_document(self):
        """Whether a pay link may name this entry: a customer invoice once posted."""
        self.ensure_one()
        return self.move_type == 'out_invoice' and self.state != 'draft'

    def _webvue_pay_state(self):
        """``paid``, ``payable`` or ``not_payable``, before any payment on its way is considered."""
        self.ensure_one()
        if self.payment_state in PAID_STATES:
            return 'paid'
        return 'payable' if self._has_to_be_paid() else 'not_payable'

    def _webvue_pay_amount(self):
        """What the payer pays now: the whole residual."""
        self.ensure_one()
        return self.amount_residual

    def _webvue_pay_link(self):
        """The ``payment.transaction`` values that link a payment to this invoice."""
        return {'invoice_ids': [Command.set(self.ids)]}
