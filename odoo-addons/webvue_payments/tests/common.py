# Part of Odoo. See LICENSE file for full copyright and licensing details.
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
    """A switched-on Paymob gateway (test mode, fake keys) and a posted 115 SAR customer invoice."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        sar = cls.env.ref('base.SAR')
        sar.active = True
        cls.paymob.sudo().write({
            **PAYMOB_CREDENTIALS,
            'paymob_account_country_id': cls.env.ref('base.sa').id,
            'state': 'test',
            'is_published': True,
        })
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
