# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
from odoo.exceptions import LockError

from .payer_service import OPEN_CHECKOUT, checkout_open, payment_on_its_way

PAY_PATH = '/pay/order/%s'


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # Set by webvue.payments.service on the online orders it creates. An order still unpaid after it is
    # cancelled by the expiry cron, which releases what the order holds.
    webvue_payment_deadline = fields.Datetime(copy=False, readonly=True, index='btree_not_null')

    def _compute_access_url(self):
        # The customer pays an online order on the WebVue pay page; the stock /my/orders page is closed by the guard.
        super()._compute_access_url()
        for order in self.filtered('require_payment'):
            order.access_url = PAY_PATH % order.id

    # A payable document of webvue.payments.payer, like a customer account.move.

    def _webvue_is_pay_document(self):
        """Whether a pay link may name this order: one that asks to be paid online."""
        self.ensure_one()
        return self.require_payment

    def _webvue_pay_state(self):
        """``paid`` once the payment the order asked for confirmed it, ``payable`` while it may still be paid."""
        self.ensure_one()
        if self.state == 'sale' and self._is_confirmation_amount_reached():
            return 'paid'
        if self._has_to_be_paid() and not self._webvue_past_deadline():
            return 'payable'
        return 'not_payable'

    def _webvue_pay_amount(self):
        """What the payer pays now: the part the order asks for (all of it, or the deposit) not received yet."""
        self.ensure_one()
        return max(self.currency_id.round(self._get_prepayment_required_amount() - self.amount_paid), 0.0)

    def _webvue_pay_link(self):
        """The ``payment.transaction`` values that link a payment to this order."""
        return {'sale_order_ids': [Command.set(self.ids)]}

    def _webvue_past_deadline(self):
        self.ensure_one()
        return bool(self.webvue_payment_deadline) and self.webvue_payment_deadline <= fields.Datetime.now()

    def _webvue_refund_due(self):
        """Whether the order holds money it must give back: any received while cancelled, or more than its total.

        A late payment is never refused or refunded automatically (spec 5.4 rule 3): staff refund it.
        """
        self.ensure_one()
        received = sum(tx.amount for tx in self.transaction_ids if tx.state == 'done')
        kept = 0.0 if self.state == 'cancel' else self.amount_total
        return self.currency_id.compare_amounts(received, kept) > 0

    @api.model
    def _webvue_cron_expire_unpaid(self):
        """Cancel the online orders still unpaid past their deadline, through stock ``_action_cancel``.

        An order with a payment on its way, or with a checkout opened less than ``OPEN_CHECKOUT`` ago, is
        left to a later run, so a payer already on the gateway page is not cancelled under them; an order
        whose checkout is being started right now (row locked) too.
        """
        now = fields.Datetime.now()
        for order in self.search([('webvue_payment_deadline', '<=', now), ('state', 'in', ('draft', 'sent'))]):
            try:
                order.lock_for_update(allow_referencing=True)
            except LockError:
                continue
            if payment_on_its_way(order.transaction_ids) or checkout_open(order.transaction_ids, now - OPEN_CHECKOUT):
                continue
            order._action_cancel()
