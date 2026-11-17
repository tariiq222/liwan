# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models

from .sales_settings import FEATURE as FINANCE_FEATURE
from odoo.addons.liwan_finance.serializers.common import dump_day, dump_number
from odoo.addons.liwan_sales.models.access_service import ORDERS_CONFIRM

INVOICES_READ = 'finance.invoices.read'
INVOICES_MANAGE = 'finance.invoices.manage'
SALES_FEATURE = 'sales.enabled'
CONFIRMED = 'sale'


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _liwan_reads_invoices(self, user):
        """Whether ``user`` reads the invoices of this order: Finance is in the plan and they hold ``finance.invoices.read``
        in the order's company. Without it the order shows no invoicing at all, so no number or amount leaks."""
        self.ensure_one()
        return bool(
            self.env['liwan.entitlement.service']._liwan_feature_read(FINANCE_FEATURE)
            and self.env['liwan.access.service']._liwan_has_capability(user, INVOICES_READ, company=self.company_id),
        )

    def _liwan_invoices_for(self, user):
        """Whether the company's ``invoice_actor`` setting lets ``user`` invoice this order: ``any_biller`` lets any caller
        who holds both rights, ``owner`` only its salesperson or a holder of ``sales.documents.assign``."""
        self.ensure_one()
        if self.env['liwan.sales.settings']._liwan_current().invoice_actor == 'any_biller':
            return True
        return self.env['liwan.sales.visibility']._liwan_acts_for(self, user)

    def _liwan_can_invoice(self, user):
        """Whether ``user`` may make an invoice of this order now: both applications can be written, they hold
        ``sales.orders.confirm`` and ``finance.invoices.manage`` in the order's company, the ``invoice_actor`` setting
        lets them act on this order, and it is a confirmed staff document (an online order is invoiced by the payments
        service when it is paid)."""
        self.ensure_one()
        entitlement = self.env['liwan.entitlement.service']
        access = self.env['liwan.access.service']
        return bool(
            self.liwan_staff_document and self.state == CONFIRMED and self._liwan_invoices_for(user)
            and entitlement._liwan_feature_write(SALES_FEATURE) and entitlement._liwan_feature_write(FINANCE_FEATURE)
            and access._liwan_has_capability(user, ORDERS_CONFIRM, company=self.company_id)
            and access._liwan_has_capability(user, INVOICES_MANAGE, company=self.company_id),
        )

    def _liwan_invoice_moves(self):
        """The customer invoices of this order and the credit notes that reverse or settle them, newest first.

        Stock links an invoice through its lines (``invoice_ids``, refunds made from the order included); a credit note
        made from an invoice is found by the invoice it reverses.
        """
        self.ensure_one()
        linked = self.invoice_ids
        reversals = self.env['account.move'].search([
            ('move_type', '=', 'out_refund'), ('reversed_entry_id', 'in', linked.filtered(lambda move: move.move_type == 'out_invoice').ids),
        ])
        return (linked | reversals).sorted('id', reverse=True)

    def _liwan_in_order_currency(self, move, amount):
        """``amount`` of ``move`` in the currency of the order (an invoice may have been re-priced in another one)."""
        return move.currency_id._convert(
            amount, self.currency_id, self.company_id, move.invoice_date or fields.Date.context_today(self), round=False,
        )

    def _liwan_invoice_figures(self, moves=None):
        """What this order invoiced, credited and holds in draft invoices, what is still to invoice and what was paid.

        Counted in the order's currency from the customer invoices and credit notes found by ``_liwan_invoice_moves``:
        - ``invoiced``: posted invoices; ``credited``: posted credit notes;
        - ``drafted``: draft invoices, which claim an amount until they are posted or cancelled (cancelling one gives it back);
        - ``to_invoice``: the total of a confirmed order less the invoiced and the drafted, never below zero. A credit note
          does not open it again, as in stock: finance drafts a new invoice if the credited work is billed again;
        - ``paid``: what payments settled on the posted invoices, less what the posted credit notes gave back, never below
          zero. Money a customer paid at the gateway before an invoice existed is on the order's payment
          (``liwan_sales``) until the invoice is posted, when stock reconciles it with the invoice and it counts here.
        Needs ``finance.invoices.read``: the caller has checked it.
        """
        self.ensure_one()
        moves = self._liwan_invoice_moves() if moves is None else moves
        posted = moves.filtered(lambda move: move.state == 'posted')
        invoices = posted.filtered(lambda move: move.move_type == 'out_invoice')
        credit_notes = posted - invoices
        convert = self._liwan_in_order_currency
        invoiced = sum(convert(move, move.amount_total) for move in invoices)
        credited = sum(convert(move, move.amount_total) for move in credit_notes)
        paid = sum(convert(move, move.amount_total - move.amount_residual) for move in invoices) - sum(
            convert(move, move.amount_total - move.amount_residual) for move in credit_notes
        )
        drafted = sum(
            convert(move, move.amount_total)
            for move in moves.filtered(lambda move: move.state == 'draft' and move.move_type == 'out_invoice')
        )
        to_invoice = max(self.amount_total - invoiced - drafted, 0.0) if self.state == CONFIRMED else 0.0
        money = self.currency_id.round
        return {
            'invoiced': money(invoiced), 'credited': money(credited), 'drafted': money(drafted),
            'to_invoice': money(to_invoice), 'paid': money(max(paid, 0.0)),
        }

    def _liwan_invoicing_status(self, figures, moves):
        """``none`` (not confirmed, or nothing to bill), ``to_invoice`` (no live invoice yet), ``partial`` (some invoiced,
        some still to invoice) or ``invoiced`` (nothing left to invoice)."""
        if self.state != CONFIRMED or self.currency_id.is_zero(self.amount_total):
            return 'none'
        live = moves.filtered(lambda move: move.state != 'cancel')
        if self.currency_id.is_zero(figures['to_invoice']):
            return 'invoiced' if live else 'none'
        return 'partial' if live else 'to_invoice'

    @staticmethod
    def _liwan_invoice_kind(move):
        """``credit_note``, ``down_payment`` (every product line is a down payment) or ``invoice`` (a final invoice
        that deducts down payments is an invoice)."""
        if move.move_type == 'out_refund':
            return 'credit_note'
        lines = move.invoice_line_ids.filtered(lambda line: line.display_type == 'product')
        return 'down_payment' if lines and all(line.is_downpayment for line in lines) else 'invoice'

    def _liwan_dump_invoice(self, move):
        return {
            'id': move.id,
            'number': dump_number(move.name),
            'state': move.state,
            'kind': self._liwan_invoice_kind(move),
            'payment_state': move.payment_state,
            'invoice_date': dump_day(move.invoice_date),
            'invoice_date_due': dump_day(move.invoice_date_due),
            'amount_total': move.currency_id.round(move.amount_total),
            'amount_residual': move.currency_id.round(move.amount_residual),
            'currency': move.currency_id.name,
        }

    def _liwan_invoicing(self, user):
        """The invoicing block of the staff order shape for ``user``: None unless they read finance invoices, else the
        status, the four amounts, the invoices (newest first) and what they may do now."""
        self.ensure_one()
        if not self._liwan_reads_invoices(user):
            return None
        moves = self._liwan_invoice_moves()
        figures = self._liwan_invoice_figures(moves)
        can_invoice = self._liwan_can_invoice(user)
        has_room = self.currency_id.compare_amounts(figures['to_invoice'], 0.0) > 0
        settings = self.env['liwan.sales.settings']._liwan_current()
        return {
            'status': self._liwan_invoicing_status(figures, moves),
            'amount_invoiced': figures['invoiced'],
            'amount_credited': figures['credited'],
            'amount_drafted': figures['drafted'],
            'amount_to_invoice': figures['to_invoice'],
            'amount_paid': figures['paid'],
            'invoices': [self._liwan_dump_invoice(move) for move in moves],
            # Stock invoices what its invoicing policy makes due (an undelivered good is not), so the whole-order action
            # follows its own status; a down payment only needs an amount left.
            'can_invoice': bool(can_invoice and self.invoice_status == 'to invoice'),
            'can_down_payment': bool(can_invoice and has_room and settings.invoice_down_payment == 'allow'),
        }

    def _liwan_staff_extras(self, user):
        return {**super()._liwan_staff_extras(user), 'invoicing': self._liwan_invoicing(user)}

    def _liwan_actions(self, user):
        """The state table of Sales, with one rule added: an order with a posted invoice is not cancelled (the invoice is
        credited in finance first), and an order with a draft invoice is cancelled only by someone who may cancel that
        invoice, which stock does with the order: it needs ``finance.invoices.manage`` and Finance in the plan for writing."""
        actions = super()._liwan_actions(user)
        if actions['cancel'] and self.state == CONFIRMED:
            live = self.invoice_ids.filtered(lambda move: move.state != 'cancel')
            may_cancel_drafts = bool(
                self.env['liwan.entitlement.service']._liwan_feature_write(FINANCE_FEATURE)
                and self.env['liwan.access.service']._liwan_has_capability(user, INVOICES_MANAGE, company=self.company_id),
            )
            if any(move.state == 'posted' for move in live) or (live and not may_cancel_drafts):
                actions['cancel'] = False
        return actions

    def _prepare_invoice(self):
        """The invoice of a staff order made through Sales carries its company's own sales journal, as a finance invoice
        does: stock's own pick may match a parent company's journal that a branch cannot read."""
        values = super()._prepare_invoice()
        if self.env.context.get('liwan_sales_invoice') and 'journal_id' not in values:
            journal = self.env['account.journal'].search([('company_id', '=', self.company_id.id), ('type', '=', 'sale')], limit=1)
            if journal:
                values['journal_id'] = journal.id
        return values
