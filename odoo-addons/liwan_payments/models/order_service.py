# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, ConcurrencyError, LockError, UserError

from .access_service import ORDERS_READ, REFUND, SYSTEM_ADMIN
from .payer_service import STUCK_AFTER, payment_stuck

OPEN_STATES = ('draft', 'sent')
ONLINE_ORDER = ('liwan_payment_deadline', '!=', False)


class NotPayable(UserError):
    """The document does not need a payment now."""


class NoGateway(UserError):
    """No live gateway can take this document's payment."""


class NotInvoiceable(UserError):
    """A payment of the document could not be recorded: it is not invoiceable as the tenant set it up."""


class RefundRefused(UserError):
    """The refund does not fit what the order must give back, or its refund rules."""


class RefundConflict(UserError):
    """The refund cannot be recorded now (another refund or a payment of the order is being recorded) or was already."""


class LiwanPaymentsService(models.AbstractModel):
    """What a selling application does with online orders, and the pay link of a payable document.

    The application authorizes its own record first and links it to the order line it gets back;
    this service never reads application data. No method takes a price or an amount: the
    product's price and the stock order computation decide them. The application's user holds no
    sales rights, so orders are elevated inside and returned unelevated: the caller keeps ids only
    and reads the payment facts through ``_liwan_summary``.
    """

    _name = 'liwan.payments.service'
    _description = 'LiwanOS payments service'

    @api.model
    def _liwan_new_order(self, company, partner, prepayment_percent=1.0):
        """A new online order of ``company`` for ``partner``, cancelled if it is still unpaid after the company's expiry.

        It is confirmed by stock once paid online: all of it, or ``prepayment_percent`` of it as a
        deposit. It asks for no signature.
        """
        elevated = self.sudo().env
        expiry = elevated['liwan.payments.settings']._liwan_expiry(company)
        order = elevated['sale.order'].with_company(company).create({
            'company_id': company.id,
            'partner_id': partner.id,
            'require_payment': True,
            'require_signature': False,
            'prepayment_percent': prepayment_percent,
            'liwan_payment_deadline': fields.Datetime.now() + expiry,
        })
        return self.env['sale.order'].browse(order.id)

    @api.model
    def _liwan_add_line(self, order, product, quantity=1):
        """Add ``quantity`` of ``product`` at its own price to an open online order; the new line, unelevated."""
        order = order.sudo()
        if not order.liwan_payment_deadline or order.state not in OPEN_STATES:
            raise UserError(self.env._("Only an open online order takes new lines."))
        line = order.env['sale.order.line'].with_company(order.company_id).create({
            'order_id': order.id,
            'product_id': product.id,
            'product_uom_qty': quantity,
        })
        if order.env['liwan.payments.settings']._liwan_tax_mode(order.company_id) == 'included':
            # The price the seller set is what the customer pays: its taxes are the price-included twins of the product's.
            line.tax_ids = [Command.set(self._liwan_included_taxes(line.tax_ids).ids)]
        return self.env['sale.order.line'].browse(line.id)

    @api.model
    def _liwan_included_taxes(self, taxes):
        """``taxes`` as price-included taxes, so a price that already contains its tax is charged to the cent.

        Rounding the net price to cents cannot give back the exact gross price, hence a tax set to 'included in price'.
        Each tax has one active copy (``liwan_included_of_id``), made on first use and replaced when the tax it copies
        has changed since (rate, group or repartition lines); a group tax is replaced by the copies of its children, so
        nothing is ever added on top of the price. A tax that is already price-included is kept. ``taxes`` must come
        from an elevated environment. Two requests that make the first copy together: one fails on the unique index and
        is retried, finding the copy the other committed.
        """
        included = taxes.env['account.tax']
        for tax in taxes:
            if tax.amount_type == 'group':
                included |= self._liwan_included_taxes(tax.children_tax_ids)
            elif tax.price_include:
                included |= tax
            else:
                included |= self._liwan_included_copy(tax)
        return included

    @api.model
    def _liwan_included_copy(self, tax):
        copy = tax.env['account.tax'].search([('liwan_included_of_id', '=', tax.id)], limit=1)
        if copy and self._liwan_tax_signature(copy) == self._liwan_tax_signature(tax):
            return copy
        if copy:
            # Out of date: archived, not edited, because posted documents may use it.
            copy.active = False
        try:
            with self.env.cr.savepoint():
                return tax.copy({
                    'name': self.env._("%(name)s (price included)", name=tax.name),
                    'price_include_override': 'tax_included', 'liwan_included_of_id': tax.id,
                })
        except UniqueViolation as error:
            raise ConcurrencyError(f'the price-included copy of tax {tax.id} was made by another request') from error

    @staticmethod
    def _liwan_tax_signature(tax):
        """What makes two taxes charge the same amounts and report them the same way."""
        lines = tuple(sorted(
            (line.document_type, line.repartition_type, line.factor_percent, line.account_id.id, tuple(sorted(line.tag_ids.ids)))
            for line in tax.repartition_line_ids
        ))
        return (tax.amount_type, tax.amount, tax.tax_group_id.id, tax.type_tax_use, tax.tax_scope, tax.include_base_amount, lines)

    @api.model
    def _liwan_orders_of(self, lines):
        """The orders of ``lines`` (the links an application keeps to the lines it added), unelevated."""
        return self.env['sale.order'].browse(lines.sudo().order_id.ids)

    @api.model
    def _liwan_request_cancel(self, orders, requested_by_customer=False, service_start=False):
        """Cancel ``orders`` not cancelled yet, through stock ``_action_cancel``.

        Money already received stays recorded and is due back (spec 5.4 rule 3): all of it, unless the
        customer asked for the cancellation, when the refund rules of the products keep their share
        (``service_start`` is when the sold service begins, for the notice tiers).
        """
        orders = orders.sudo().filtered(lambda order: order.state != 'cancel')
        if requested_by_customer:
            now = fields.Datetime.now()
            for order in orders:
                order._liwan_retain_for_customer_cancellation(service_start, now)
        orders._action_cancel()

    @api.model
    def _liwan_record_refund(self, order, amount, reference):
        """Record ``amount`` the tenant refunded in the gateway dashboard under the gateway's ``reference``.

        Stock Paymob has no refund API (spec F14), so the money moves on the gateway first. Each part is
        a refund child of a received payment, newest first, done with ``reference``; stock post-processing
        then records the outbound payment and reconciles it with the credit notes of a cancelled order.
        The order is locked, so two refunds never both take the same amount due.

        :return: the refund transactions, unelevated.
        :raise AccessError: when the caller lacks ``payments.refund`` in the order's company.
        :raise RefundRefused: when ``amount`` exceeds what is due, or is not all of it where the rules
            ask for the whole amount.
        :raise RefundConflict: when another refund of the order is being recorded, a payment of it is not
            recorded yet, or a refund with ``reference`` is recorded already.
        """
        order = order.sudo()
        self._liwan_require_capability_in(REFUND, order.company_id)
        try:
            order.lock_for_update(allow_referencing=True)
        except LockError as error:
            raise RefundConflict(self.env._("Another refund of this order is being recorded.")) from error
        order.invalidate_recordset()
        payments = order.transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation != 'refund')
        if any(not tx.is_post_processed for tx in payments):
            # Stock records no payment entry for a transaction that already has a done child.
            raise RefundConflict(self.env._("A payment of this order is still being recorded; try again later."))
        if payments.child_transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.provider_reference == reference):
            raise RefundConflict(self.env._("A refund with this gateway reference is already recorded on this order."))
        currency = order.currency_id
        due = order.liwan_refund_due_amount
        if currency.compare_amounts(amount, 0.0) <= 0 or currency.compare_amounts(amount, due) > 0:
            raise RefundRefused(self.env._("A refund is more than zero and at most the amount due."))
        if not order._liwan_allows_partial_refunds() and currency.compare_amounts(amount, due) != 0:
            raise RefundRefused(self.env._("The refund rules of this order ask for the whole amount due at once."))
        credit_notes = self.env['account.move']
        if order.state == 'cancel':
            # What the merchant keeps stays invoiced: only the rest of the invoiced amount is credited.
            to_credit = min(amount, max(order._liwan_open_invoiced() - order.liwan_retained_amount, 0.0))
            credit_notes = order._liwan_credit_notes(to_credit)
        refunds = self._liwan_refund_payments(order, amount, reference, credit_notes)
        refunds._set_done()
        refunds._post_process()
        # Who recorded which gateway refund: the order is elevated, so its author is the caller, named here.
        order.message_post(author_id=self.env.user.partner_id.id, body=self.env._(
            "Refund of %(amount)s recorded under the gateway reference %(reference)s.", amount=amount, reference=reference,
        ))
        credited = sum(credit_notes.mapped('amount_total'))
        if credit_notes and currency.compare_amounts(credited, to_credit) != 0:
            order.message_post(body=self.env._(
                "The credit notes of this refund total %(credited)s, not %(amount)s: review them with an accountant.",
                credited=credited, amount=to_credit,
            ))
        return self.env['payment.transaction'].browse(refunds.ids)

    @api.model
    def _liwan_refund_payments(self, order, amount, reference, credit_notes):
        """The refund children taking ``amount`` from the order's received payments, newest first."""
        currency = order.currency_id
        payments = order.transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation != 'refund')
        refunds = order.env['payment.transaction']
        left = amount
        for payment in payments.sorted('id', reverse=True):
            refunded = payment.child_transaction_ids.filtered(lambda tx: tx.state == 'done' and tx.operation == 'refund')
            part = min(left, payment.amount + sum(refunded.mapped('amount')))
            if currency.compare_amounts(part, 0.0) <= 0:
                continue
            refunds |= payment._create_child_transaction(
                part, is_refund=True, provider_reference=reference, invoice_ids=[Command.set(credit_notes.ids)],
            )
            left -= part
            if currency.compare_amounts(left, 0.0) <= 0:
                break
        return refunds

    @api.model
    def _liwan_company_orders(self, company, refund_due=None, needs_attention=None, states=None, limit=None, offset=0):
        """The online orders of ``company`` for its payments staff, newest first, and how many match, unelevated.

        Staff hold no sales rights: the orders are read elevated once ``payments.orders.read`` is checked in
        ``company`` itself (a capability held only in a branch does not open the parent's orders).
        """
        self._liwan_require_capability_in(ORDERS_READ, company)
        domain = [ONLINE_ORDER, ('company_id', '=', company.id)]
        if refund_due is not None:
            domain.append(('liwan_refund_due_amount', '>' if refund_due else '=', 0))
        if needs_attention is not None:
            stuck = ('transaction_ids', 'any', [
                ('state', '=', 'done'), ('is_post_processed', '=', False),
                ('last_state_change', '<', fields.Datetime.now() - STUCK_AFTER),
            ])
            domain.append(stuck if needs_attention else ('transaction_ids', 'not any', stuck[2]))
        if states:
            domain.append(('state', 'in', states))
        Order = self.env['sale.order'].sudo()
        orders = Order.search(domain, order='date_order desc, id desc', limit=limit, offset=offset)
        return self.env['sale.order'].browse(orders.ids), Order.search_count(domain)

    @api.model
    def _liwan_company_order(self, company, order_id):
        """The online order ``order_id`` of ``company``, unelevated, or an empty recordset."""
        self._liwan_require_capability_in(ORDERS_READ, company)
        order = self.env['sale.order'].sudo().search([('id', '=', order_id), ('company_id', '=', company.id), ONLINE_ORDER])
        return self.env['sale.order'].browse(order.ids)

    @api.model
    def _liwan_order_row(self, order):
        """The order's number, customer and date with its payment summary, for payments staff."""
        elevated = order.sudo()
        return {
            'number': elevated.name,
            'customer': elevated.partner_id.name or '',
            'date': elevated.date_order,
            **self._liwan_summary(order),
        }

    @api.model
    def _liwan_order_details(self, order):
        """What payments staff see of one online order beyond its summary: customer, lines, money moves, rules."""
        order = order.sudo()
        moves = order.transaction_ids.filtered(lambda tx: tx.operation != 'refund')
        moves |= moves.child_transaction_ids.filtered(lambda tx: tx.operation == 'refund')
        return {
            'lines': order._liwan_sold_lines(),
            'transactions': moves.sorted(lambda tx: (tx.create_date, tx.id)),
            'partial_refunds': order._liwan_allows_partial_refunds(),
        }

    @api.model
    def _liwan_require_capability_in(self, key, company):
        if not self.env['liwan.access.service']._liwan_has_capability(self.env.user, key, company=company):
            raise AccessError(self.env._('forbidden'))

    @api.model
    def _liwan_summary(self, order):
        """The payment facts of one online order, for the staff of the application selling through it.

        ``status`` is the payer's status, or ``cancelled``; ``expires_at`` is the payment deadline;
        ``amount_received`` is what it received less its refunds, ``amount_to_refund`` what it must give back.
        ``needs_attention``: money was received but has not been recorded on the order for an hour
        (its post-processing keeps failing), so a person must look at it.
        """
        order = order.sudo()
        cancelled = order.state == 'cancel'
        return {
            'status': 'cancelled' if cancelled else self.env['liwan.payments.payer']._liwan_status(order),
            'needs_attention': payment_stuck(order.transaction_ids, fields.Datetime.now()),
            'currency': order.currency_id.name,
            'amount_total': order.amount_total,
            'amount_due': 0.0 if cancelled else order._liwan_pay_amount(),
            'amount_received': order._liwan_net_received(),
            'amount_to_refund': order.liwan_refund_due_amount,
            'expires_at': order.liwan_payment_deadline,
        }

    @api.model
    def _liwan_system_admin_invoice(self, invoice_id):
        """The invoice a system administrator makes a pay link for without invoice access, or None.

        Only when the invoice's company allows it (``system_admin_links``, off by default), only for a
        system administrator of that company and only for an invoice of the companies the session is in; the record is
        returned elevated so the caller can read what the link needs. An invoice that does not
        exist there is an empty record.
        """
        access = self.env['liwan.access.service']
        # The capability first: the settings row is readable by settings managers only, and any other caller is refused here.
        if not access._liwan_has_capability(self.env.user, SYSTEM_ADMIN):
            return None
        invoice = self.env['account.move'].sudo().search([
            ('id', '=', invoice_id), ('company_id', 'in', self.env.companies.ids),
        ], limit=1)
        # The invoice's own company decides, not the company the session happens to be in.
        company = invoice.company_id
        if invoice and not (
            access._liwan_has_capability(self.env.user, SYSTEM_ADMIN, company=company)
            and self.env['liwan.payments.settings']._liwan_system_admin_links(company)
        ):
            return None
        return invoice

    @api.model
    def _liwan_payment_path(self, document):
        """The pay-page path of a payable document the caller has authorized; its access token is made once.

        The answer is a path, not a URL: the browser that shows it knows the tenant's public origin,
        which the server cannot always tell behind the edge.

        :raise NotInvoiceable: when a payment of the document could not be recorded.
        :raise NotPayable: when nothing is to be paid now.
        :raise NoGateway: when no live gateway can take the payment.
        """
        document = document.sudo()
        if not document._liwan_payment_recordable():
            raise NotInvoiceable(self.env._("Set up the sales journal in Finance before customers pay online orders."))
        if document._liwan_pay_state() != 'payable':
            raise NotPayable(self.env._("Nothing needs to be paid now."))
        if not self.env['liwan.payments.payer']._liwan_options(document):
            raise NoGateway(self.env._("Switch a payment gateway to live first."))
        return document.get_portal_url()
