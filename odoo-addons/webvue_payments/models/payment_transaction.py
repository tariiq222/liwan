# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

REJECTIONS = 'webvue_payments_rejections'


class PaymentTransaction(models.Model):
    _inherit = 'payment.transaction'

    def _process(self, provider_code, payment_data):
        """Check the amount and currency of every notification, not only the first one.

        Stock ``_process`` skips the update only when *this* call moves the transaction to
        ``error``, so a second notification with the same wrong amount (Paymob sends the return
        and the webhook) moved it to ``done``. A transaction already in ``error`` is re-checked
        here with the stock validation, and a rejected payload never reaches the updates. A valid
        notification after a decline still completes, as stock intends (``error -> done``).
        """
        tx = self or self._search_by_reference(provider_code, payment_data)
        if tx and tx.state == 'error' and tx._webvue_payments_rejects(payment_data):
            return tx
        return super()._process(provider_code, payment_data)

    def _webvue_payments_rejects(self, payment_data):
        """Whether the stock amount/currency validation rejects ``payment_data`` for this transaction."""
        self.ensure_one()
        rejections = []
        self.with_context(**{REJECTIONS: rejections})._validate_amount(payment_data)
        return bool(rejections)

    def _set_error(self, state_message, extra_allowed_states=()):
        # Record the rejection while _webvue_payments_rejects asks; stock then keeps the state.
        rejections = self.env.context.get(REJECTIONS)
        if rejections is not None:
            rejections.append(state_message)
        return super()._set_error(state_message, extra_allowed_states=extra_allowed_states)
