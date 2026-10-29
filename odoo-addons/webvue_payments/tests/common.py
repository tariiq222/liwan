# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase

PAYMOB_CREDENTIALS = {
    'paymob_public_key': 'egy_pk_test_spike',
    'paymob_secret_key': 'egy_sk_test_never_returned',
    'paymob_hmac_key': 'hmac_never_returned',
    'paymob_api_key': 'api_never_returned',
}


class WebVuePaymentsCase(WebVueApiCase):
    """The shared webvue_api fixture plus a system administrator and the company's stock Paymob provider."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='payments_admin', password='payments_admin_pass_123',
            name='Payments administrator', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_core.role_system_admin').id,
            'company_id': cls.env.company.id,
        }])
        cls.paymob = cls.env['payment.provider'].search([
            ('code', '=', 'paymob'), ('company_id', '=', cls.env.company.id),
        ], limit=1)

    def login_admin(self):
        self.authenticate('payments_admin', 'payments_admin_pass_123')


class WebVuePayerCase(WebVuePaymentsCase):
    """A live Paymob gateway (fake keys, no network) and a posted 115 SAR customer invoice."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        sar = cls.env.ref('base.SAR')
        sar.active = True
        cls.paymob.sudo().write({
            **PAYMOB_CREDENTIALS,
            'paymob_account_country_id': cls.env.ref('base.sa').id,
            'state': 'enabled',
            'is_published': True,
        })
        # A tenant's company carries the Saudi chart, whose sales journals send ZATCA e-invoices; these
        # invoices are posted through a journal that is not onboarded (the ZATCA tests of finance onboard one).
        zatca = cls.env.ref('l10n_sa_edi.edi_sa_zatca', raise_if_not_found=False)
        if zatca:
            cls.env['account.journal'].search([('company_id', '=', cls.env.company.id)]).edi_format_ids = [Command.unlink(zatca.id)]
        cls.customer = cls.env['res.partner'].create({'name': 'Payer customer', 'email': 'payer@example.test'})
        cls.invoice = cls.customer_invoice()
        cls.invoice._portal_ensure_token()
        cls.card = cls.env.ref('payment.payment_method_card')

    @classmethod
    def customer_invoice(cls, amount=115.0, move_type='out_invoice', post=True):
        invoice = cls.env['account.move'].create({
            'move_type': move_type,
            'partner_id': cls.customer.id,
            'currency_id': cls.env.ref('base.SAR').id,
            'invoice_date': '2026-10-28',
            'invoice_date_due': '2026-11-27',
            'invoice_line_ids': [Command.create({'name': 'Service', 'quantity': 1, 'price_unit': amount, 'tax_ids': []})],
        })
        if post:
            invoice.action_post()
        return invoice

    def summary_url(self, invoice=None, token=None):
        invoice = invoice or self.invoice
        return f'/api/v1/public/payments/invoices/{invoice.id}?access_token={token or invoice.access_token}'

    def start_url(self, invoice=None):
        return f'/api/v1/public/payments/invoices/{(invoice or self.invoice).id}/transactions'

    @classmethod
    def paymob_transaction(cls, amount, **link):
        """A Paymob checkout of ``amount`` SAR for the document named by ``link`` (``invoice_ids`` or ``sale_order_ids``)."""
        Transaction = cls.env['payment.transaction']
        return Transaction.create({
            'provider_id': cls.paymob.id,
            'payment_method_id': cls.card.id,
            'reference': Transaction._compute_reference('paymob', **link),
            'amount': amount,
            'currency_id': cls.env.ref('base.SAR').id,
            'partner_id': cls.customer.id,
            'operation': 'online_redirect',
            'provider_reference': '987654',
            **link,
        })

    @staticmethod
    def paymob_notification(tx, amount_cents, success=True):
        """A Paymob notification after the stock controller's normalization."""
        return {
            'merchant_order_id': tx.reference, 'order': '987654', 'amount_cents': str(amount_cents),
            'currency': 'SAR', 'success': 'true' if success else 'false', 'pending': 'false',
            'data.message': 'Approved' if success else 'Declined',
        }


class WebVueOrderCase(WebVuePayerCase):
    """The payer fixture plus a service sold at 115 SAR to the customer through online orders."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['product.product'].create({
            'name': 'Consultation', 'type': 'service', 'list_price': 115.0, 'taxes_id': [Command.clear()],
        })
        cls.customer.property_product_pricelist = cls.env['product.pricelist'].create({
            'name': 'SAR', 'currency_id': cls.env.ref('base.SAR').id,
            'item_ids': [Command.create({
                'applied_on': '0_product_variant', 'product_id': cls.service.id,
                'compute_price': 'fixed', 'fixed_price': 115.0,
            })],
        })

    @classmethod
    def online_order(cls, prepayment_percent=1.0):
        service = cls.env['webvue.payments.service']
        order = service._webvue_new_order(cls.env.company, cls.customer, prepayment_percent)
        service._webvue_add_line(order, cls.service)
        return cls.env['sale.order'].browse(order.id)

    def pay(self, order, amount):
        """A Paymob payment of ``amount`` SAR for ``order``, notified and post-processed as the relay does."""
        tx = self.paymob_transaction(amount, sale_order_ids=[Command.set(order.ids)])
        tx._process('paymob', self.paymob_notification(tx, round(amount * 100)))
        tx._post_process()
        return tx

    def expire(self):
        """Run the expiry cron; its per-order commits are no-ops inside the test transaction."""
        self.patch(type(self.env['ir.cron']), '_commit_progress', lambda cron, processed=0, **_: float('inf'))
        self.env['sale.order']._webvue_cron_expire_unpaid()

    def age(self, transactions, **delta):
        """Move the last state change of ``transactions`` back by ``delta`` (``timedelta`` keywords)."""
        self.env.flush_all()
        self.env.cr.execute(
            "UPDATE payment_transaction SET last_state_change = last_state_change - %s WHERE id IN %s",
            [timedelta(**delta), tuple(transactions.ids)],
        )
        self.env.invalidate_all()

    def order_url(self, order, suffix=''):
        return f'/api/v1/public/payments/orders/{order.id}{suffix}'
