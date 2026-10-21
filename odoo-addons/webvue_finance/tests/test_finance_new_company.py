# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueFinanceCase

LOGIN = 'finance_new_company_manager'
PASSWORD = 'finance_new_company_pass_123'
API = '/api/v1/finance'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceNewCompany(WebVueFinanceCase):
    """A company with no chart is set up, then runs a purchase cycle, with WebVue routes only (no ORM write by the test)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fresh = cls._fresh_company_manager('Finance New Company', LOGIN, PASSWORD)

    def call(self, method, path, json=None, status=200):
        result = self.api(method, f'{API}{path}', json=json)
        self.assertEqual(result.status_code, status, result.text)
        return result.json()

    def test_set_up_and_run_a_purchase_cycle_from_the_routes(self):
        self.authenticate(LOGIN, PASSWORD)
        # 1. The chart: the Saudi template is loaded by the route.
        self.assertEqual(self.call('GET', '/setup')['chart']['loaded'], False)
        self.assertTrue(self.call('POST', '/setup/chart', {})['chart']['loaded'])
        # 2. Accounts, a purchase tax, a payment term and journals made by the routes.
        expense = self.call('POST', '/accounts', {'code': '600900', 'name': 'Office supplies', 'account_type': 'expense'}, 201)
        cash_account = self.call('POST', '/accounts', {'code': '101900', 'name': 'Site cash', 'account_type': 'asset_cash'}, 201)
        vat_account = self.call('POST', '/accounts', {'code': '101950', 'name': 'Input VAT (new)', 'account_type': 'asset_current'}, 201)
        tax = self.call('POST', '/taxes', {
            'name': 'Input VAT 15% (new)', 'type_tax_use': 'purchase', 'amount': 15, 'tax_account_id': vat_account['id'],
        }, 201)
        self.call('POST', '/payment-terms', {'name': 'Net 30', 'lines': [{'value': 'percent', 'value_amount': 100, 'nb_days': 30}]}, 201)
        purchases = self.call('POST', '/journals', {'name': 'Site purchases', 'code': 'SPU', 'type': 'purchase'}, 201)
        cash = self.call('POST', '/journals', {'name': 'Site cash', 'code': 'SCH', 'type': 'cash', 'default_account_id': cash_account['id']}, 201)
        # 3. A vendor and a vendor bill of 1000 + 15% VAT.
        vendor = self.call('POST', '/partners', {'name': 'Riyadh Stationery', 'vendor': True}, 201)
        bill = self.call('POST', '/invoices', {
            'move_type': 'in_invoice', 'partner_id': vendor['id'], 'invoice_date': '2026-10-10', 'journal_id': purchases['id'],
            'lines': [{'name': 'Paper', 'quantity': 10, 'price_unit': 100, 'tax_ids': [tax['id']], 'account_id': expense['id']}],
        }, 201)
        self.assertEqual(self.env['account.move'].browse(bill['id']).journal_id.id, purchases['id'])
        posted = self.call('POST', f'/invoices/{bill["id"]}/post')
        self.assertEqual((posted['state'], posted['amount_total']), ('posted', 1150))
        # 4. The payment and the books.
        payment = self.call('POST', '/payments', {
            'invoice_ids': [bill['id']], 'amount': 1150, 'payment_date': '2026-10-12', 'journal_id': cash['id'],
        }, 201)
        self.assertEqual(payment['amount'], 1150)
        self.assertEqual(self.call('GET', f'/invoices/{bill["id"]}')['amount_residual'], 0)
        report = self.call('GET', '/reports/trial-balance?date_from=2026-01-01&date_to=2026-12-31')
        rows = {row['account']['code']: row for row in report['accounts']}
        self.assertEqual((rows['600900']['debit'], rows['600900']['credit']), (1000, 0))
        self.assertEqual((rows['101950']['debit'], rows['101950']['credit']), (150, 0))
        self.assertEqual(report['totals']['debit'], report['totals']['credit'])
        # 5. Everything is the new company's; the other companies' charts are untouched.
        self.assertEqual(self.env['account.move'].browse(bill['id']).company_id, self.fresh)
        actions = self.env['webvue.finance.audit.event'].search([('company_id', '=', self.fresh.id)]).mapped('action')
        self.assertTrue({'chart_loaded', 'account_created', 'journal_created', 'tax_created', 'payment_term_created'} <= set(actions))
