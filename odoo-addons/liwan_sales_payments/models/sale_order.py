# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import LockError

from .sales_settings import payments_open
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_payments.models.access_service import REFUND
from odoo.addons.liwan_sales.models.sale_order import QUOTATION_STATES

# The transaction states that count as received (README, "What received means"); only ``done`` money can be refunded.
RECEIVED_STATES = ('authorized', 'done')
# A quotation in one of these states holds money that is due back (README, "Money due back").
NOTES = {
    'expired': 'A payment (%s) arrived after the quotation expired. The order was not confirmed: extend the validity and send the quotation again, or give the money back.',
    'reopened': 'A payment (%s) arrived while the quotation was a draft. The order was not confirmed: send the quotation again, or give the money back.',
    'cancelled': 'A payment (%s) arrived after the quotation was cancelled. The order was not confirmed and the money is due back.',
}
NO_SENDER_NOTE = 'The order was confirmed by its payment, but no confirmation e-mail was sent: no sender address is configured.'


def confirm_or_conflict(order):
    """``order._liwan_confirm_by_payment()`` for a customer or staff request: a row another transaction holds is a 409
    ``conflict`` to retry, not a server error. The payment callback calls it directly, so stock retries it."""
    try:
        return order._liwan_confirm_by_payment()
    except LockError as error:
        code = 'conflict'
        raise LiwanAccessRule(code, 'this quotation is being changed by a payment right now; try again', status=409) from error


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _liwan_payment_mode(self):
        """How this quotation asks to be paid, read from stock's own fields: ``off``, ``full`` or ``percent``."""
        self.ensure_one()
        if not self.require_payment:
            return 'off'
        return 'full' if self._liwan_payment_percent() == 100 else 'percent'

    def _liwan_payment_percent(self):
        """The whole percent of the total the customer pays; 100 for a quotation that does not ask for a part."""
        self.ensure_one()
        return round(self.prepayment_percent * 100) if self.require_payment else 100

    # ---- what received means (one rule for the threshold, ``held``, ``amount_received`` and the pay amount) ----

    def _liwan_own_payments(self, states):
        """The payments of this order alone in ``states``: a transaction shared with another order stays stock's."""
        self.ensure_one()
        # Sales staff hold no payment rights (the stock ``transaction_ids`` field is for accounting groups only); only the
        # amounts are summed, and the caller already reads this order.
        return self.sudo().transaction_ids.filtered(
            lambda tx: tx.operation != 'refund' and tx.state in states and tx.sale_order_ids == self,
        )

    def _liwan_received(self):
        """What this staff quotation received: its authorized and done payments, less their done refunds."""
        payments = self._liwan_own_payments(RECEIVED_STATES)
        refunds = payments.child_transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation == 'refund')
        return sum(payments.mapped('amount')) + sum(refunds.mapped('amount'))

    def _liwan_asks_payment(self):
        """Whether this quotation asks to be paid: ``require_payment`` with a required amount above zero. A total of zero, or a
        percentage that rounds to 0.00, asks for nothing, everywhere."""
        self.ensure_one()
        return bool(self.require_payment and self.currency_id.compare_amounts(self._get_prepayment_required_amount(), 0.0) > 0)

    def _liwan_reached(self):
        """Whether this quotation asks to be paid and received at least what it asks."""
        self.ensure_one()
        return self._liwan_asks_payment() and self._is_confirmation_amount_reached()

    def _liwan_holds_money(self):
        """Whether this quotation received anything (authorized or done, less refunds)."""
        return self.currency_id.compare_amounts(self._liwan_received(), 0.0) > 0

    def _is_confirmation_amount_reached(self):
        if not self.liwan_staff_document:
            return super()._is_confirmation_amount_reached()
        return self.currency_id.compare_amounts(self._get_prepayment_required_amount(), self._liwan_received()) <= 0

    def _liwan_pay_amount(self):
        if not self.liwan_staff_document:
            return super()._liwan_pay_amount()
        return max(self.currency_id.round(self._get_prepayment_required_amount() - self._liwan_received()), 0.0)

    @api.depends('liwan_staff_document')
    def _compute_liwan_refund_due_amount(self):
        """A staff quotation keeps nothing before it is confirmed: everything it holds may go back (done money only, an
        authorized payment is voided at the gateway). A confirmed one keeps its total, as an online order does."""
        staff = self.filtered('liwan_staff_document')
        super(SaleOrder, self - staff)._compute_liwan_refund_due_amount()
        for order in staff:
            kept = order.amount_total if order.state == 'sale' else 0.0
            order.liwan_refund_due_amount = max(order.currency_id.round(order._liwan_net_received() - kept), 0.0)

    # ---- the pay document ----

    def _liwan_is_pay_document(self):
        """A staff quotation is a pay document only while its own customer page opens (sent, confirmed or cancelled, and
        not reopened since): the pay routes answer the same 404 as Sales does otherwise."""
        if not self.liwan_staff_document:
            return super()._liwan_is_pay_document()
        return bool(self._liwan_asks_payment() and self._liwan_public_open())

    def _liwan_pay_state(self):
        """A staff quotation is payable only while it is sent and, when it asks for a signature, signed: a customer who
        has not signed yet cannot pay, and a reopened one cannot be paid through the link of its earlier send."""
        state = super()._liwan_pay_state()
        if state == 'payable' and self.liwan_staff_document and (self.state != 'sent' or self._has_to_be_signed()):
            return 'not_payable'
        return state

    def _liwan_awaiting_signature(self):
        """Whether this sent quotation asks to be paid and the customer has to sign it first."""
        self.ensure_one()
        return bool(
            self.liwan_staff_document and self._liwan_asks_payment() and self.state == 'sent' and self._has_to_be_signed()
            and self._has_to_be_paid(),
        )

    def _liwan_gateway_ready(self):
        """Whether a live gateway can take this quotation's payment: the check the pay page makes."""
        return bool(self.env['liwan.payments.payer']._liwan_options(self))

    def _liwan_payment_link_state(self, status):
        """What the customer can do about the payment now, given the payer ``status``: ``ready`` (pay), ``no_gateway``
        (payable, but no live gateway), ``awaiting_signature`` (sign first), ``none`` (nothing to pay, or paid or being
        paid, or confirmed) or ``unavailable``."""
        self.ensure_one()
        if not self._liwan_asks_payment() or self.state not in QUOTATION_STATES or self._liwan_reached() or status == 'processing':
            return 'none'
        if status == 'payable':
            return 'ready' if self._liwan_gateway_ready() else 'no_gateway'
        return 'awaiting_signature' if self._liwan_awaiting_signature() else 'unavailable'

    def _liwan_held_reason(self):
        """Why money on this quotation does not confirm it, or None. ``expired``, ``reopened`` (a draft again) or
        ``cancelled`` (declined included): it holds money, any amount, that is due back. ``awaiting_signature``: it received
        what it asks and the customer has not signed yet."""
        self.ensure_one()
        if self.state == 'sale' or not self._liwan_asks_payment():
            return None
        if self.state != 'sent' or self.is_expired:
            reason = {'draft': 'reopened', 'cancel': 'cancelled'}.get(self.state, 'expired')
            return reason if self._liwan_holds_money() else None
        return 'awaiting_signature' if self._liwan_reached() and self._has_to_be_signed() else None

    def _liwan_attention(self, summary):
        """Why a person must look at this order's money, or None: ``payment_not_recorded`` (money received but not recorded
        on the order for an hour) or ``payment_reversed`` (confirmed, then a payment it counted was voided, so it holds less
        than it asked)."""
        self.ensure_one()
        if summary['needs_attention']:
            return 'payment_not_recorded'
        if self.state == 'sale' and self._liwan_asks_payment() and not self._liwan_reached() and self._liwan_own_payments(('cancel',)):
            return 'payment_reversed'
        return None

    # ---- what each page says ----

    def _liwan_staff_extras(self, user):
        extras = super()._liwan_staff_extras(user)
        if not self.liwan_staff_document or not self.env['liwan.entitlement.service']._liwan_feature_read('payments.enabled'):
            return {**extras, 'payment': None}
        # The payer's facts are read elevated by the payments service; the caller already reads this order.
        summary = self.env['liwan.payments.service']._liwan_summary(self)
        held = self._liwan_held_reason()
        refundable = self.liwan_refund_due_amount
        attention = self._liwan_attention(summary)
        # What must go back: all of it once held, what a confirmed order received beyond its total, nothing on an open one.
        due_back = refundable if held in NOTES or self.state == 'sale' else 0.0
        return {**extras, 'payment': {
            'mode': self._liwan_payment_mode(),
            'percent': self._liwan_payment_percent(),
            'currency': summary['currency'],
            'amount_required': self._get_prepayment_required_amount(),
            'amount_received': self._liwan_received(),
            'amount_due': self._liwan_pay_amount() if self._liwan_asks_payment() and self.state in QUOTATION_STATES else 0.0,
            'amount_to_refund': due_back,
            'amount_refundable': refundable,
            'can_refund': self._liwan_can_refund(user),
            'status': summary['status'] if self._liwan_asks_payment() else 'none',
            'link': self._liwan_payment_link_state(summary['status']),
            'held': held,
            'needs_attention': bool(attention),
            'attention': attention,
        }}

    def _liwan_can_refund(self, user):
        """Whether ``user`` may record a refund of this quotation now: they may change it in Sales, they hold
        ``payments.refund`` in its company, the tenant can take payments and it holds money that may go back."""
        self.ensure_one()
        keys = self.env['liwan.access.service']._liwan_capability_keys(user, company=self.company_id)
        mine = self.user_id == user or self.env['liwan.sales.visibility']._liwan_can_assign(user, self.company_id)
        return bool(
            mine and REFUND in keys and payments_open(self.env)
            and self.currency_id.compare_amounts(self.liwan_refund_due_amount, 0.0) > 0,
        )

    def _liwan_public_extras(self):
        extras = super()._liwan_public_extras()
        if not (self._liwan_asks_payment() and payments_open(self.env)):
            return {**extras, 'payment': None}
        state = self._liwan_public_pay_state()
        if not state:
            return {**extras, 'payment': None}
        return {**extras, 'payment': {
            'percent': self._liwan_payment_percent(),
            'amount': 0.0 if state in ('paid', 'received') else self._liwan_pay_amount(),
            'currency': self.currency_id.name,
            'pay_url': self.get_portal_url() if state == 'payable' else None,
            'state': state,
        }}

    def _liwan_public_pay_state(self):
        """What the customer's page says of the payment: ``paid`` (confirmed with what it asks), ``received`` (what it asks
        arrived and the seller has not confirmed the order yet), ``processing``, ``payable``, ``awaiting_signature`` or
        ``unavailable``; None for an order the seller confirmed without the payment (nothing is asked of the customer)."""
        self.ensure_one()
        if self._liwan_reached():
            return 'paid' if self.state == 'sale' else 'received'
        if self.state == 'sale':
            return None
        status = self.env['liwan.payments.payer']._liwan_status(self)
        if status == 'processing' and self.state in QUOTATION_STATES:
            return 'processing'
        link = self._liwan_payment_link_state(status)
        return {'ready': 'payable', 'awaiting_signature': 'awaiting_signature'}.get(link, 'unavailable')

    # ---- confirmation by payment ----

    def _liwan_confirm_by_payment(self, transaction=None):
        """Confirm this staff quotation now that it has received what it asks, through the path staff confirm uses.

        The order row is locked and read again first (``LockError`` when another transaction holds it), so two callbacks
        never both confirm it or both note one payment. Returns the order when it was confirmed, else an empty recordset:
        nothing is asked or received yet, the customer still has to sign (the signature confirms it later), or it cannot be
        confirmed now (expired, back to a draft or cancelled). In the last case the payment stays recorded on the order, a
        note per ``transaction`` says the money is due back, and sending the quotation again confirms it. A confirmed order
        is left as it is. In ``accept`` mode the payment is also the customer's acceptance and is recorded as one. The
        customer gets the Sales confirmation e-mail once; without a sender the order says none was sent.
        """
        self.ensure_one()
        nothing = self.browse()
        if not (self.liwan_staff_document and self.require_payment):
            return nothing
        order = self.with_company(self.company_id)
        order.lock_for_update(allow_referencing=True)
        order.invalidate_recordset()
        if order.state not in (*QUOTATION_STATES, 'cancel'):
            return nothing
        reason = order._liwan_held_reason()
        if reason in NOTES:
            order._liwan_note_held(reason, transaction)
            return nothing
        if not order._liwan_reached() or reason:
            return nothing
        order._liwan_record_payment_answer()
        self.env['liwan.sales.service'].with_company(order.company_id)._liwan_move(order, 'confirm')
        if not self.env['liwan.sales.document']._liwan_queue_confirmation_mail(order):
            order.message_post(body=NO_SENDER_NOTE, subtype_xmlid='mail.mt_note')
        return self

    def _liwan_note_held(self, reason, transaction):
        """Say once per ``transaction`` why its payment did not confirm the order; nothing without a transaction."""
        if not transaction:
            return
        body = NOTES[reason] % transaction.reference
        if not self.message_ids.filtered(lambda message: body in (message.body or '')):
            self.message_post(body=body, subtype_xmlid='mail.mt_note')

    def _liwan_record_payment_answer(self):
        """Record the payment as the customer's acceptance when the quotation was sent for an answer and has none yet."""
        self.ensure_one()
        if self.liwan_answer_mode == 'accept' and not self.liwan_answer:
            self.write({'liwan_answer': 'accepted', 'liwan_answered_on': fields.Datetime.now()})

    def _liwan_acceptance_confirms(self):
        """A quotation that asks to be paid is confirmed by its payment, never by the acceptance alone: the acceptance is
        recorded and the payment (already there, or still to come) confirms it, whether or not the tenant can take
        payments now: staff confirm it by hand otherwise."""
        if self._liwan_asks_payment():
            return False
        return super()._liwan_acceptance_confirms()
