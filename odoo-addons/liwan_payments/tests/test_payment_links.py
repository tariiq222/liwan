# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanPayerCase
from odoo.addons.liwan_payments.controllers.links import PaymentLinkController

LINKS = '/api/v1/payments/links'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymentLinks(LiwanPayerCase):

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
        credit = self.customer_invoice(move_type='out_refund')
        self.assertEqual(credit.access_url, f'/my/invoices/{credit.id}')

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

    def test_no_link_without_a_live_gateway(self):
        self.login_admin()
        for state in ('test', 'disabled'):
            with self.subTest(state=state):
                self.paymob.sudo().write({'state': state, 'is_published': False})
                response = self.create_link(self.invoice.id)
                self.assertEqual((response.status_code, response.json()['code']), (422, 'no_gateway'))

    def test_an_invoice_the_caller_cannot_read_gets_no_link(self):
        reader = self.env['res.users'].browse(self.admin.id)
        reader.group_ids -= self.env.ref('base.group_system')
        self.login_admin()
        response = self.create_link(self.invoice.id)
        body = response.json()
        self.assertEqual((response.status_code, body['code']), (403, 'link_access_required'))
        self.assertIn('finance.invoices.read', body['message'])
        self.assertEqual(body['details'], {'capability': 'finance.invoices.read'})

    def without_invoice_access(self, allow):
        """The system administrator holds no invoice access; the company setting says whether that is enough."""
        self.env['res.users'].browse(self.admin.id).group_ids -= self.env.ref('base.group_system') | self.env.ref('account.group_account_invoice')
        self.env['liwan.payments.settings'].create({'company_id': self.env.company.id, 'system_admin_links': allow})
        self.login_admin()

    def test_a_system_administrator_creates_links_without_invoice_access_when_the_company_allows_it(self):
        self.without_invoice_access(True)
        response = self.create_link(self.invoice.id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'path': f'/pay/invoice/{self.invoice.id}?access_token={self.invoice.access_token}'})
        self.assertEqual(self.create_link(self.invoice.id + 100000).status_code, 404)

    def test_the_company_setting_off_refuses_a_system_administrator_and_names_the_capability(self):
        self.without_invoice_access(False)
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'link_access_required'))
        self.assertIn('finance.invoices.read', response.json()['message'])

    def test_the_invoice_company_decides_not_the_company_of_the_session(self):
        # Company A allows system administrators to create links, company B does not; the session is in A and reaches both.
        company_b = self.env['res.company'].create({'name': 'Links company B', 'parent_id': self.env.company.id})
        income = self.env['account.account'].create({
            'name': 'Income B', 'code': '400100', 'account_type': 'income', 'company_ids': [Command.set(company_b.ids)],
        })
        receivable = self.env['account.account'].create({
            'name': 'Receivable B', 'code': '120100', 'account_type': 'asset_receivable', 'reconcile': True,
            'company_ids': [Command.set(company_b.ids)],
        })
        self.customer.with_company(company_b).property_account_receivable_id = receivable
        self.env['account.journal'].create({'name': 'Sales B', 'code': 'SLB', 'type': 'sale', 'company_id': company_b.id})
        invoice_b = self.env['account.move'].with_company(company_b).create({
            'move_type': 'out_invoice', 'partner_id': self.customer.id, 'invoice_date': '2026-10-28',
            'invoice_line_ids': [Command.create({'name': 'Service', 'quantity': 1, 'price_unit': 10, 'account_id': income.id, 'tax_ids': []})],
        })
        self.without_invoice_access(True)
        admin = self.env['res.users'].browse(self.admin.id)
        admin.company_ids |= company_b
        self.env['liwan.access.assignment']._liwan_access_create({
            'user_id': admin.id, 'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': company_b.id,
        })
        self.login_admin()
        refused = self.create_link(invoice_b.id)
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'link_access_required'), refused.text)
        self.env['liwan.payments.settings'].create({'company_id': company_b.id, 'system_admin_links': True})
        allowed = self.create_link(invoice_b.id)
        # Past the permission gate: a draft invoice has nothing to pay yet.
        self.assertEqual((allowed.status_code, allowed.json()['code']), (409, 'not_payable'), allowed.text)

    def test_the_setting_gives_nothing_to_a_user_who_is_not_a_system_administrator(self):
        self.without_invoice_access(True)
        user = new_test_user(self.env, login='links_only', password='links_only_pass_123', name='Links only', groups='liwan_core.group_employee')
        role = self.env['liwan.access.role'].create({
            'key': 'links_only', 'name_ar': 'links', 'name_en': 'links', 'type': 'custom',
            'permission_ids': [Command.set(self.env['liwan.access.permission'].search([('key', '=', 'payments.links.manage')]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': self.env.company.id}])
        self.authenticate('links_only', 'links_only_pass_123')
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'link_access_required'), response.text)

    def test_the_capability_gate_is_declared_and_refuses_an_employee(self):
        self.assertEqual(PaymentLinkController.create_link._liwan_capability_keys, ('payments.links.manage',))
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.create_link(self.invoice.id)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
