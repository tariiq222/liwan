# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models

REJECTIONS = 'liwan_payments_rejections'
PROCESSED = 'liwan_payments_processed'


class Collector:
    """A per-call holder passed through the context.

    It compares by identity, so Odoo never mistakes two calls' environments for the same one,
    which an empty list (equal to every other empty list) would allow.
    """

    __slots__ = ('items',)

    def __init__(self):
        self.items = []


class PaymentTransaction(models.Model):
    _inherit = 'payment.transaction'

    def _process(self, provider_code, payment_data):
        """Check the amount and currency of every notification, not only the first one.

        Stock ``_process`` skips the update only when *this* call moves the transaction to
        ``error``, so a second notification with the same wrong amount (Paymob sends the return
        and the webhook) moved it to ``done``. A transaction already in ``error`` is re-checked
        here with the stock validation, and a rejected payload never reaches the updates. A valid
        notification after a decline still completes, as stock intends (``error -> done``).

        A relay call (``PROCESSED`` in the context) is told which transaction it processed.
        """
        tx = self or self._search_by_reference(provider_code, payment_data)
        if not tx:
            return tx
        if tx.state == 'error' and tx._liwan_payments_rejects(payment_data):
            return tx
        processed = super(PaymentTransaction, tx)._process(provider_code, payment_data)
        collector = self.env.context.get(PROCESSED)
        if collector is not None:
            collector.items.append(processed)
        return processed

    def _liwan_payments_rejects(self, payment_data):
        """Whether the stock amount/currency validation rejects ``payment_data`` for this transaction."""
        self.ensure_one()
        rejections = Collector()
        self.with_context(**{REJECTIONS: rejections})._validate_amount(payment_data)
        return bool(rejections.items)

    def _set_error(self, state_message, extra_allowed_states=()):
        # Record the rejection while _liwan_payments_rejects asks; stock then keeps the state.
        rejections = self.env.context.get(REJECTIONS)
        if rejections is not None:
            rejections.items.append(state_message)
        return super()._set_error(state_message, extra_allowed_states=extra_allowed_states)
