# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, models
from odoo.exceptions import LockError

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

AUDIT_FIELDS = ('invoice_line_ids', 'invoice_origin')


def _refused(code, message, field=None, status=422, details=None):
    raise LiwanAccessRule(code, message, field=field, status=status, details=details)


class LiwanSalesService(models.AbstractModel):
    _inherit = 'liwan.sales.service'

    @api.model
    def _liwan_invoice(self, order_id, values):
        """Make a draft customer invoice of the confirmed staff order ``order_id`` from parsed ``values``.

        ``values`` is ``{method: 'order'}`` (what is invoiceable, less the down payments already invoiced), or
        ``{method: 'percent', percent}`` or ``{method: 'amount', amount}`` (a down payment of that share of the order total
        or of that total, taxes included). The invoice is made by stock's ``sale.advance.payment.inv``; the bridge posts
        nothing: finance staff post it with finance's own rules. 404 for an order the caller does not read; 403 ``forbidden``
        for an online order and for an order that is not the caller's while ``invoice_actor`` is ``owner``; 409 ``conflict``
        while another request holds the order; 422 ``order_not_confirmed``, ``nothing_to_invoice``, ``down_payment_refused``, ``no_journal``,
        and ``invalid`` on ``percent`` or ``amount`` beyond what is left to invoice.
        """
        order = self._liwan_invoiceable(order_id, values)
        invoice = self._liwan_make_invoice(order, values)
        self.env['liwan.finance.audit.event']._liwan_log('invoice_created', invoice, fields_written=AUDIT_FIELDS, outcome=invoice.state)
        order.invalidate_recordset()
        return order

    @api.model
    def _liwan_invoiceable(self, order_id, values):
        """The order once every refusal has passed, in the order a person meets them.

        The order row is locked before any figure is read, so two requests for one order never both find room: the
        second is a 409 ``conflict`` to retry, and finds the first one's invoice when it does.
        """
        order = self._liwan_order(order_id)
        if not order.liwan_staff_document:
            _refused(
                'forbidden', 'an online order is invoiced when it is paid', status=403, details={'reason': 'online_order'},
            )
        if not order._liwan_invoices_for(self.env.user):
            _refused(
                'forbidden', 'this company lets only the salesperson of an order invoice it', status=403,
                details={'reason': 'not_the_salesperson'},
            )
        order = self._liwan_lock(order)
        if order.state != 'sale':
            _refused('order_not_confirmed', 'only a confirmed order is invoiced')
        figures = order._liwan_invoice_figures()
        method = values['method']
        if method != 'order' and self.env['liwan.sales.settings']._liwan_current().invoice_down_payment != 'allow':
            _refused('down_payment_refused', 'this company invoices an order whole: down payments are off in the Sales settings', field='method')
        currency = order.currency_id
        if currency.compare_amounts(figures['to_invoice'], 0.0) <= 0 or (method == 'order' and order.invoice_status != 'to invoice'):
            _refused('nothing_to_invoice', 'nothing is left to invoice on this order')
        if method != 'order':
            self._liwan_require_room(order, values, figures['to_invoice'])
        if not self.env['account.journal'].search_count([('company_id', '=', order.company_id.id), ('type', '=', 'sale')]):
            _refused('no_journal', 'create a sales journal in the finance settings first', field='journal_id')
        return order

    @api.model
    def _liwan_lock(self, order):
        """``order`` locked and read again (a ``NO KEY UPDATE`` lock, as Sales takes when a payment confirms an order: the invoice only adds
        lines that point at the row), else 409 ``conflict`` when another transaction holds it."""
        try:
            order.lock_for_update(allow_referencing=True)
        except LockError as error:
            code = 'conflict'
            raise LiwanAccessRule(code, 'this order is being invoiced right now; try again', status=409) from error
        order.invalidate_recordset()
        return order

    @api.model
    def _liwan_require_room(self, order, values, left):
        """422 ``invalid`` on ``percent`` or ``amount`` when the down payment is more than the order has left to invoice."""
        currency = order.currency_id
        if values['method'] == 'percent':
            field, wanted = 'percent', currency.round(order.amount_total * values['percent'] / 100.0)
        else:
            field, wanted = 'amount', currency.round(values['amount'])
        if currency.compare_amounts(wanted, 0.0) <= 0:
            _refused('invalid', 'the down payment must be more than zero', field=field)
        if currency.compare_amounts(wanted, left) > 0:
            _refused('invalid', 'the down payment is more than what is left to invoice', field=field, details={'max_amount': left})

    @api.model
    def _liwan_make_invoice(self, order, values):
        """The draft invoice stock makes of ``order`` for ``values``, returned in the caller's environment.

        The wizard runs elevated with the order's company, as stock itself creates the invoice with ``sudo()``, because
        a member of Sales and Finance cannot read what its preparation reads: `sale_project` reads `project.project` to
        default the analytic distribution, and a branch session cannot read the root company's taxes, so a down payment
        computed there would carry none. It runs only after the checks of ``_liwan_invoiceable`` (the order is readable, a
        confirmed staff document of the working company, and the caller holds both capabilities), touches that one order
        and its invoice, and the invoice goes back to the caller's environment.
        """
        method = values['method']
        wizard_values = {'sale_order_ids': [Command.set(order.ids)]}
        if method == 'order':
            wizard_values.update(advance_payment_method='delivered', deduct_down_payments=True, consolidated_billing=False)
        elif method == 'percent':
            wizard_values.update(advance_payment_method='percentage', amount=values['percent'])
        else:
            wizard_values.update(advance_payment_method='fixed', fixed_amount=values['amount'])
        elevated = order.sudo().with_company(order.company_id).with_context(liwan_sales_invoice=True)
        wizard = self.env['sale.advance.payment.inv'].sudo().with_company(order.company_id).with_context(liwan_sales_invoice=True).create(wizard_values)
        wizard._check_amount_is_positive()
        invoices = wizard._create_invoices(elevated)
        # One order makes one invoice; a final invoice whose down payments exceed the order is a credit note stock makes itself.
        return self.env['account.move'].browse(invoices[:1].ids)
