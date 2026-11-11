# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from requests import RequestException

from odoo import api, fields, models
from odoo.exceptions import LockError, UserError

from .payer_service import RECONCILE_AFTER, RECONCILE_BATCH, SETTLE_WINDOW
from odoo.addons.payment_paymob.controllers.main import PaymobController

_logger = logging.getLogger(__name__)

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

    # One recorded refund may be split over several payments; each split part carries the whole refund's
    # amount, so a replay of the same gateway refund is recognised however it was split.
    liwan_refund_amount = fields.Monetary(currency_field='currency_id', copy=False, readonly=True)
    # When the reconciliation last asked the gateway about this checkout: each run asks the ones asked
    # longest ago first, so checkouts that never get an answer cannot hold the others out of the batch.
    liwan_gateway_checked_at = fields.Datetime(copy=False, readonly=True)

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

    @api.model
    def _liwan_cron_reconcile_paymob(self):
        """Ask Paymob about the checkouts that never got an answer.

        A lost webhook for a payer who never came back leaves a transaction draft or pending. Each
        one older than ``RECONCILE_AFTER`` and younger than ``SETTLE_WINDOW`` is queried, at most
        ``RECONCILE_BATCH`` per run, never-asked and longest-unasked first. The batch's check time is
        committed before any query, so a checkout whose query fails, however it fails, goes to the
        back of the queue and never holds the others out of the batch. Rows a webhook holds right
        now are skipped: the webhook is settling them.
        """
        now = fields.Datetime.now()
        transactions = self.search([
            ('provider_code', '=', 'paymob'), ('state', 'in', ('draft', 'pending')),
            ('provider_reference', '!=', False),
            ('create_date', '<=', now - RECONCILE_AFTER), ('create_date', '>=', now - SETTLE_WINDOW),
        ], order='liwan_gateway_checked_at asc nulls first, create_date', limit=RECONCILE_BATCH)
        transactions = transactions.try_lock_for_update(allow_referencing=True)
        transactions.liwan_gateway_checked_at = now
        Cron = self.env['ir.cron']
        Cron._commit_progress(remaining=len(transactions))
        for tx in transactions:
            tx._liwan_reconcile_paymob()
            if not Cron._commit_progress(1):
                break

    def _liwan_post_process_now(self, lock_timeout_ms=None):
        """Confirm, record and reconcile these settled transactions now, as stock's status poll does.

        This does not depend on the post-processing cron, which stock switches off with the last active
        gateway. A failure is logged and handed to that cron, switched back on if needed (stock retries
        for four days); the payment itself stays recorded. With ``lock_timeout_ms`` a row another
        transaction holds (the invoice being posted, say) is waited for only that long.
        """
        for tx in self:
            if tx.is_post_processed or tx.state not in ('authorized', 'done'):
                continue
            try:
                with self.env.cr.savepoint():
                    if lock_timeout_ms:
                        self.env.cr.execute('SET LOCAL lock_timeout = %s', [lock_timeout_ms])
                    tx._post_process()
                    if lock_timeout_ms:
                        self.env.cr.execute('RESET lock_timeout')
            except Exception:
                _logger.exception("Post-processing of payment transaction %s failed; the cron will retry it", tx.reference)
                tx.provider_id._toggle_post_processing_cron()
                self.env.ref('payment.cron_post_process_payment_tx')._trigger()

    def _liwan_reconcile_paymob(self):
        """Settle this checkout from Paymob's own record when Paymob says it is paid or being paid.

        Only an answer that moves the payment forward (``success`` or ``pending``) is processed, through
        ``_process`` as the webhook would be, so the amount and currency are re-checked and a replay of a
        notification already processed is ignored. A decline, a missing answer, an answer about another
        order or a failed query changes nothing: declines stay the webhook's to report, since a payer may
        retry on the same Paymob order. A failure is logged with the reference and error type only, never
        with provider data.
        """
        self.ensure_one()
        try:
            self.lock_for_update(allow_referencing=True)
        except LockError:
            return
        self.invalidate_recordset()
        if self.state not in ('draft', 'pending'):
            return
        try:
            with self.env.cr.savepoint():
                self._liwan_settle_from_paymob()
        except (UserError, RequestException, ValueError, TypeError, KeyError) as error:
            _logger.info("Paymob gave no usable answer for transaction %s (%s)", self.reference, type(error).__name__)

    def _liwan_settle_from_paymob(self):
        data = self.provider_id._send_api_request(
            'POST', '/api/ecommerce/orders/transaction_inquiry',
            json={'order_id': int(self.provider_reference)}, reference=self.reference,
        )
        if not isinstance(data, dict) or not data.get('id') or not (data.get('success') or data.get('pending')):
            return
        normalized = PaymobController._normalize_response({**data, 'data': data.get('data') or {}}, None)
        if normalized['order'] != self.provider_reference or normalized['merchant_order_id'] != self.reference:
            _logger.warning("Paymob's answer for transaction %s names another order; ignored", self.reference)
            return
        self._process('paymob', normalized)
        self._liwan_post_process_now()
