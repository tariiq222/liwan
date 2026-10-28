# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePayerCase
from odoo.addons.webvue_payments.controllers.links import PaymentLinkController

LINKS = '/api/v1/payments/links'


@tagged('post_install', '-at_install', 'webvue')
class TestPaymentLinks(WebVuePayerCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A link is offered only on invoices the caller can read. In a tenant that is a finance
        # capability in the invoice's company; here the system group stands in for it, so these
        # tests do not depend on the finance application.
        cls.admin.group_ids |= cls.env.ref('base.group_system') | cls.env.ref('account.group_account_invoice')

    def create_link(self, invoice_id, **extra):
        return self.api('POST', LINKS, json={'invoice_id': invoice_id, **extra})

    def test_the_link_is_the_pay_page_path_with_the_access_token(self):
        self.login_admin()
        response = self.create_link(self.invoice.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {'path': f'/pay/invoice/{self.invoice.id}?access_token={self.invoice.access_token}'},
        )
        self.assertEqual(self.invoice.access_url, f'/pay/invoice/{self.invoice.id}')

    def test_only_a_payable_customer_invoice_gets_a_link(self):
        self.login_admin()
        draft = self.customer_invoice(post=False)
        credit = self.customer_invoice(move_type='out_refund')
        for invoice_id, status, code in (
            (draft.id, 409, 'not_payable'),
            (credit.id, 422, 'invalid'),
            (self.invoice.id + 100000, 404, 'not_found'),
        ):
            with self.subTest(code=code):
                response = self.create_link(invoice_id)
                self.assertEqual((response.status_code, response.json()['code']), (status, code))
        unknown = self.create_link(self.invoice.id, amount=1)
        self.assertEqual((unknown.status_code, unknown.json()['code']), (422, 'unknown_field'))

    def test_no_link_without_a_switched_on_gateway(self):
        self.paymob.sudo().write({'state': 'disabled', 'is_published': False})
        self.login_admin()
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (422, 'no_gateway'))

    def test_an_invoice_the_caller_cannot_read_gets_no_link(self):
        reader = self.env['res.users'].browse(self.admin.id)
        reader.group_ids -= self.env.ref('base.group_system')
        self.login_admin()
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_the_capability_gate_is_declared_and_refuses_an_employee(self):
        self.assertEqual(PaymentLinkController.create_link._webvue_capability_keys, ('payments.links.manage',))
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
