# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, models
from odoo.tools import float_is_zero, float_round

PAY_PATH = '/pay/invoice/%s'
PAID_STATES = ('paid', 'in_payment')
# The Saudi localization (stock l10n_sa) asks every customer credit note for its ZATCA reason; an online
# order is credited only once it is cancelled.
SA_REASON_FIELD = 'l10n_sa_reason'
SA_CANCELLATION_REASON = 'BR-KSA-17-reason-1'
# The unit-price step a partial credit note is probed with to measure how its total follows one line's price.
PRICE_PROBE = 100.0


class AccountMove(models.Model):
    _inherit = 'account.move'

    def _compute_access_url(self):
        # Customers never open Odoo: the stock /my/invoices page is closed by the LiwanOS guard, so
        # every portal link of a customer invoice (emails, share links) opens the LiwanOS pay page.
        super()._compute_access_url()
        for move in self.filtered(lambda move: move.move_type == 'out_invoice'):
            move.access_url = PAY_PATH % move.id

    # A payable document of liwan.payments.payer, like an online sale.order.

    def _liwan_is_pay_document(self):
        """Whether a pay link may name this entry: a customer invoice once posted."""
        self.ensure_one()
        return self.move_type == 'out_invoice' and self.state != 'draft'

    def _liwan_payment_recordable(self):
        """A posted invoice always records its payment (stock reconciles it)."""
        return True

    def _liwan_pay_state(self):
        """``paid``, ``payable`` or ``not_payable``, before any payment on its way is considered."""
        self.ensure_one()
        if self.payment_state in PAID_STATES:
            return 'paid'
        return 'payable' if self._has_to_be_paid() else 'not_payable'

    def _liwan_pay_amount(self):
        """What the payer pays now: the whole residual."""
        self.ensure_one()
        return self.amount_residual

    def _liwan_pay_link(self):
        """The ``payment.transaction`` values that link a payment to this invoice."""
        return {'invoice_ids': [Command.set(self.ids)]}

    def _liwan_reversal(self, amount, credited):
        """A draft credit note of this posted customer invoice for ``amount`` of what ``credited`` left open on it.

        It reverses the invoice in full when ``amount`` is all of it and nothing was credited before. Else
        each line credits its share by quantity, so percent and fixed taxes scale alike (a share too small
        for the quantity precision scales the line's price instead), and the largest line's price is fitted
        to meet ``amount``. Prices round to the price precision, so a cent may remain: the order then says
        so in its chatter.
        """
        self.ensure_one()
        credit_note = self._reverse_moves([self._liwan_reversal_values()])
        if not credited and self.currency_id.compare_amounts(amount, self.amount_total) == 0:
            return credit_note
        lines = credit_note.invoice_line_ids.filtered(lambda line: line.display_type == 'product' and line.price_unit)
        ratio = amount / self.amount_total
        digits = self.env['decimal.precision'].precision_get('Product Unit')
        updates = []
        for line in lines:
            quantity = float_round(line.quantity * ratio, precision_digits=digits)
            share = {'price_unit': line.price_unit * ratio} if float_is_zero(quantity, precision_digits=digits) else {'quantity': quantity}
            updates.append(Command.update(line.id, share))
        credit_note.write({'invoice_line_ids': updates})
        largest = max(lines, key=lambda line: abs(line.price_total), default=None)
        if largest:
            credit_note._liwan_fit_total(largest, amount)
        return credit_note

    def _liwan_fit_total(self, line, amount):
        """Move ``line``'s unit price so this draft credit note totals ``amount``.

        The total is affine in one line's unit price whatever its taxes (percent, fixed or included in the
        price), so one probe gives the slope and the price that meets ``amount``.
        """
        self.ensure_one()
        start_price, start_total = line.price_unit, self.amount_total
        if self.currency_id.is_zero(amount - start_total):
            return
        self._liwan_set_unit_price(line, start_price + PRICE_PROBE)
        slope = (self.amount_total - start_total) / PRICE_PROBE
        self._liwan_set_unit_price(line, start_price + (amount - start_total) / slope if slope else start_price)

    def _liwan_set_unit_price(self, line, price):
        self.write({'invoice_line_ids': [Command.update(line.id, {'price_unit': price})]})

    def _liwan_reversal_values(self):
        """The values of this invoice's credit note: its reference and, under the Saudi localization, its ZATCA reason."""
        values = {'ref': self.env._('Refund of %s', self.name)}
        if SA_REASON_FIELD in self._fields:
            values[SA_REASON_FIELD] = SA_CANCELLATION_REASON
        return values
