# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import UserError

OPEN_STATES = ('draft', 'sent')


class NotPayable(UserError):
    """The document does not need a payment now."""


class NoGateway(UserError):
    """No live gateway can take this document's payment."""


class WebVuePaymentsService(models.AbstractModel):
    """What a selling application does with online orders, and the pay link of a payable document.

    The application authorizes its own record first and links it to the order line it gets back;
    this service never reads application data. No method takes a price or an amount: the
    product's price and the stock order computation decide them. The application's user holds no
    sales rights, so orders are elevated inside and returned unelevated: the caller keeps ids only
    and reads the payment facts through ``_webvue_summary``.
    """

    _name = 'webvue.payments.service'
    _description = 'WebVue payments service'

    @api.model
    def _webvue_new_order(self, company, partner, prepayment_percent=1.0):
        """A new online order of ``company`` for ``partner``, cancelled if it is still unpaid after the company's expiry.

        It is confirmed by stock once paid online: all of it, or ``prepayment_percent`` of it as a
        deposit. It asks for no signature.
        """
        elevated = self.sudo().env
        expiry = elevated['webvue.payments.settings']._webvue_expiry(company)
        order = elevated['sale.order'].with_company(company).create({
            'company_id': company.id,
            'partner_id': partner.id,
            'require_payment': True,
            'require_signature': False,
            'prepayment_percent': prepayment_percent,
            'webvue_payment_deadline': fields.Datetime.now() + expiry,
        })
        return self.env['sale.order'].browse(order.id)

    @api.model
    def _webvue_add_line(self, order, product, quantity=1):
        """Add ``quantity`` of ``product`` at its own price to an open online order; the new line, unelevated."""
        order = order.sudo()
        if not order.webvue_payment_deadline or order.state not in OPEN_STATES:
            raise UserError(self.env._("Only an open online order takes new lines."))
        line = order.env['sale.order.line'].with_company(order.company_id).create({
            'order_id': order.id,
            'product_id': product.id,
            'product_uom_qty': quantity,
        })
        return self.env['sale.order.line'].browse(line.id)

    @api.model
    def _webvue_orders_of(self, lines):
        """The orders of ``lines`` (the links an application keeps to the lines it added), unelevated."""
        return self.env['sale.order'].browse(lines.sudo().order_id.ids)

    @api.model
    def _webvue_request_cancel(self, orders):
        """Cancel ``orders`` not cancelled yet, through stock ``_action_cancel``.

        Money already received stays recorded and makes the refund due (spec 5.4 rule 3).
        """
        orders.sudo().filtered(lambda order: order.state != 'cancel')._action_cancel()

    @api.model
    def _webvue_summary(self, order):
        """The payment facts of one online order, for the staff of the application selling through it.

        ``status`` is the payer's status, or ``cancelled``; ``expires_at`` is the payment deadline.
        """
        order = order.sudo()
        cancelled = order.state == 'cancel'
        return {
            'status': 'cancelled' if cancelled else self.env['webvue.payments.payer']._webvue_status(order),
            'refund_due': order._webvue_refund_due(),
            'currency': order.currency_id.name,
            'amount_total': order.amount_total,
            'amount_due': 0.0 if cancelled else order._webvue_pay_amount(),
            'expires_at': order.webvue_payment_deadline,
        }

    @api.model
    def _webvue_payment_path(self, document):
        """The pay-page path of a payable document the caller has authorized; its access token is made once.

        The answer is a path, not a URL: the browser that shows it knows the tenant's public origin,
        which the server cannot always tell behind the edge.

        :raise NotPayable: when nothing is to be paid now.
        :raise NoGateway: when no live gateway can take the payment.
        """
        document = document.sudo()
        if document._webvue_pay_state() != 'payable':
            raise NotPayable(self.env._("Nothing needs to be paid now."))
        if not self.env['webvue.payments.payer']._webvue_options(document):
            raise NoGateway(self.env._("Switch a payment gateway to live first."))
        return document.get_portal_url()
