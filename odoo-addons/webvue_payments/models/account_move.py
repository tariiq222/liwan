# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, models

PAY_PATH = '/pay/invoice/%s'
PAID_STATES = ('paid', 'in_payment')
# The Saudi localization (stock l10n_sa) asks every customer credit note for its ZATCA reason; an online
# order is credited only once it is cancelled.
SA_REASON_FIELD = 'l10n_sa_reason'
SA_CANCELLATION_REASON = 'BR-KSA-17-reason-1'


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

    def _webvue_payment_recordable(self):
        """A posted invoice always records its payment (stock reconciles it)."""
        return True

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

    def _webvue_reversal(self, amount, credited):
        """A draft credit note of this posted customer invoice for ``amount`` of what ``credited`` left open on it.

        It reverses the invoice in full when ``amount`` is all of it and nothing was credited before; else
        its lines are scaled to ``amount`` and the largest line takes the rounding. Prices round to the
        price precision, so a partial credit note may still differ from ``amount`` by a cent: the order
        then says so in its chatter. A scaled line keeps its quantity, so the cancelled order's line counts
        as fully credited; it invoices nothing more.
        """
        self.ensure_one()
        currency = self.currency_id
        credit_note = self._reverse_moves([self._webvue_reversal_values()])
        if not credited and currency.compare_amounts(amount, self.amount_total) == 0:
            return credit_note
        lines = credit_note.invoice_line_ids.filtered(lambda line: line.display_type == 'product' and line.price_unit)
        ratio = amount / self.amount_total
        credit_note.write({
            'invoice_line_ids': [Command.update(line.id, {'price_unit': line.price_unit * ratio}) for line in lines],
        })
        gap = amount - credit_note.amount_total
        largest = max(lines, key=lambda line: abs(line.price_total), default=None)
        if largest and not currency.is_zero(gap):
            per_unit_price = largest.price_total / largest.price_unit
            credit_note.write({
                'invoice_line_ids': [Command.update(largest.id, {'price_unit': largest.price_unit + gap / per_unit_price})],
            })
        return credit_note

    def _webvue_reversal_values(self):
        """The values of this invoice's credit note: its reference and, under the Saudi localization, its ZATCA reason."""
        values = {'ref': self.env._('Refund of %s', self.name)}
        if SA_REASON_FIELD in self._fields:
            values[SA_REASON_FIELD] = SA_CANCELLATION_REASON
        return values
