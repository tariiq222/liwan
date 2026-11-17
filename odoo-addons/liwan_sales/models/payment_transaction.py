# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class PaymentTransaction(models.Model):
    _inherit = 'payment.transaction'

    def _check_amount_and_confirm_order(self):
        """Confirm a staff quotation through the Sales path instead of stock's.

        Stock confirms any quotation that reached its prepayment, whatever its validity or state. A staff quotation goes
        through ``sale.order._liwan_confirm_by_payment``, which keeps the gates a staff confirm has and leaves a payment
        that came too late recorded on the order. Every other order, online orders included, is stock's. Calling it again
        for the same payment confirms nothing twice.
        """
        staff = self.filtered(lambda tx: len(tx.sale_order_ids) == 1 and tx.sale_order_ids.liwan_staff_document)
        confirmed = super(PaymentTransaction, self - staff)._check_amount_and_confirm_order()
        for tx in staff:
            confirmed |= tx.sale_order_ids._liwan_confirm_by_payment(tx)
        return confirmed
