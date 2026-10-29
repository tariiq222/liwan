# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import Command, api, fields, models
from odoo.exceptions import LockError

from .payer_service import OPEN_CHECKOUT, checkout_open, payment_on_its_way

_logger = logging.getLogger(__name__)

PAY_PATH = '/pay/order/%s'


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    # Set by webvue.payments.service on the online orders it creates. An order still unpaid after it is
    # cancelled by the expiry cron, which releases what the order holds.
    webvue_payment_deadline = fields.Datetime(copy=False, readonly=True, index='btree_not_null')
    # What the merchant keeps of a cancelled order under the refund rules of its products, set once when the
    # customer asks for the cancellation; zero for every other cancellation (spec 6.4, ticket 07).
    webvue_retained_amount = fields.Monetary(copy=False, readonly=True)
    # The money this order holds that it must give back: what it received less its refunds, beyond what it
    # keeps (its total while it stands, the retained amount once cancelled). Stored so staff filter on it.
    webvue_refund_due_amount = fields.Monetary(compute='_compute_webvue_refund_due_amount', store=True)

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
        if self._has_to_be_paid() and not self._webvue_past_deadline() and self._webvue_payment_recordable():
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

    def _webvue_net_received(self):
        """The money this order kept: its received payments less their done refunds (negative child transactions)."""
        self.ensure_one()
        payments = self.transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation != 'refund')
        refunds = payments.child_transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation == 'refund')
        return sum(payments.mapped('amount')) + sum(refunds.mapped('amount'))

    @api.depends(
        'state', 'amount_total', 'webvue_retained_amount', 'transaction_ids.state', 'transaction_ids.amount',
        'transaction_ids.child_transaction_ids.state', 'transaction_ids.child_transaction_ids.amount',
    )
    def _compute_webvue_refund_due_amount(self):
        """A late payment is never refused or refunded automatically (spec 5.4 rule 3): staff refund it."""
        for order in self:
            kept = order.webvue_retained_amount if order.state == 'cancel' else order.amount_total
            order.webvue_refund_due_amount = max(order.currency_id.round(order._webvue_net_received() - kept), 0.0)

    def _webvue_retain_for_customer_cancellation(self, service_start, now):
        """Set what the merchant keeps when the customer cancels this order ``service_start`` from ``now``.

        Each line keeps its product's share of what was received (refund_policy.py), weighted by the
        line total; nothing beyond the order total is ever kept.
        """
        self.ensure_one()
        notice = self.env['product.template']._webvue_notice_hours(service_start, now)
        received = min(self._webvue_net_received(), self.amount_total)
        if not self.amount_total or self.currency_id.compare_amounts(received, 0.0) <= 0:
            return
        kept_total = sum(
            line.price_total * (1 - line.product_id.product_tmpl_id._webvue_refund_share(self.company_id, notice))
            for line in self._webvue_sold_lines()
        )
        self.webvue_retained_amount = self.currency_id.round(received * kept_total / self.amount_total)

    def _webvue_allows_partial_refunds(self):
        """Whether one refund may be less than the amount due: only when every line's product allows it."""
        self.ensure_one()
        return all(
            line.product_id.product_tmpl_id._webvue_allows_partial_refunds(self.company_id) for line in self._webvue_sold_lines()
        )

    def _webvue_sold_lines(self):
        """The lines that sell a product: no section or note, and no down-payment line stock adds when it invoices a deposit."""
        return self.order_line.filtered(lambda line: not line.display_type and not line.is_downpayment and line.product_id)

    def _webvue_invoices_and_credit_notes(self):
        """The posted customer invoices of this order and the posted credit notes reversing them, found by the invoice they reverse."""
        self.ensure_one()
        invoices = self.invoice_ids.filtered(lambda move: move.state == 'posted' and move.move_type == 'out_invoice')
        credit_notes = self.env['account.move'].search([('reversed_entry_id', 'in', invoices.ids), ('state', '=', 'posted')])
        return invoices, credit_notes

    def _webvue_open_invoiced(self):
        """What this order invoiced and has not credited yet."""
        invoices, credit_notes = self._webvue_invoices_and_credit_notes()
        return sum(invoices.mapped('amount_total')) - sum(credit_notes.mapped('amount_total'))

    def _webvue_credit_notes(self, amount):
        """Draft credit notes for ``amount`` of what this cancelled order invoiced, newest invoice first.

        An invoice is reversed in full when the refund covers all of it, else by proportional lines.
        """
        self.ensure_one()
        drafts = self.env['account.move']
        invoices, credit_notes = self._webvue_invoices_and_credit_notes()
        left = amount
        for invoice in invoices.sorted('id', reverse=True):
            credited = credit_notes.filtered(lambda move, invoice=invoice: move.reversed_entry_id == invoice)
            part = min(left, invoice.amount_total - sum(credited.mapped('amount_total')))
            if self.currency_id.compare_amounts(part, 0.0) <= 0:
                continue
            drafts |= invoice._webvue_reversal(part, credited)
            left -= part
            if self.currency_id.compare_amounts(left, 0.0) <= 0:
                break
        return drafts

    def _webvue_payment_recordable(self):
        """Whether stock can record a payment of this order: it cannot invoice it when invoicing on payment is on
        and the company has no sales journal (finance not set up). No pay link is offered then, so the customer's
        money never lands on an order whose payment fails to be recorded.
        """
        self.ensure_one()
        if not self.env['webvue.payments.settings']._webvue_invoices_when_paid():
            return True
        Journal = self.env['account.journal']
        return bool(Journal.search_count([*Journal._check_company_domain(self.company_id), ('type', '=', 'sale')], limit=1))

    @api.model
    def _webvue_cron_expire_unpaid(self):
        """Cancel the online orders still unpaid past their deadline, one order per transaction.

        Each order is decided in a fresh transaction whose first statement locks it, so a checkout or
        a payment committed meanwhile is seen. A failure on one order is logged and left to the next
        run; it never holds the others back.
        """
        orders = self.search([('webvue_payment_deadline', '<=', fields.Datetime.now()), ('state', 'in', ('draft', 'sent'))])
        Cron = self.env['ir.cron']
        Cron._commit_progress(remaining=len(orders))
        for order in orders:
            try:
                with self.env.cr.savepoint():
                    order._webvue_expire_if_unpaid()
            except Exception:
                _logger.exception("Expiry of online order %s failed; the next run retries it", order.id)
            Cron._commit_progress(1)

    def _webvue_expire_if_unpaid(self):
        """Cancel this order through stock ``_action_cancel`` if it is still unpaid past its deadline.

        An order with a payment on its way, or with a checkout opened less than ``OPEN_CHECKOUT`` ago,
        is left to a later run, so a payer already on the gateway page is not cancelled under them; an
        order whose checkout is being started right now (row locked) too.
        """
        self.ensure_one()
        try:
            self.lock_for_update(allow_referencing=True)
        except LockError:
            return
        self.invalidate_recordset()
        now = fields.Datetime.now()
        if (
            self.state not in ('draft', 'sent') or not self._webvue_past_deadline()
            or payment_on_its_way(self.transaction_ids, now) or checkout_open(self.transaction_ids, now - OPEN_CHECKOUT)
        ):
            return
        self._action_cancel()
