# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A branch uses its parent's chart of accounts and sees only its own entries (owner decision 2026-10-31, issue #200)."""
from odoo import Command
from odoo.tests import new_test_user, tagged

from .write_common import INVOICES, PARTNERS, PAYMENTS, LiwanFinanceWriteCase

ACCOUNTS = '/api/v1/finance/accounts'
JOURNALS = '/api/v1/finance/journals'
BANK = '/api/v1/finance/bank-statements'
SETUP = '/api/v1/finance/setup'
TRIAL_BALANCE = '/api/v1/finance/reports/trial-balance?date_from=2026-01-01&date_to=2026-12-31'
BRANCH_LOGIN = 'finance_branch_manager'
BRANCH_PASSWORD = 'finance_branch_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceBranchChart(LiwanFinanceWriteCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.branch = cls.env['res.company'].create({
            'name': 'Chart Branch', 'parent_id': cls.company.id, 'country_id': cls.company.country_id.id,
            'currency_id': cls.company.currency_id.id,
        })
        cls.branch_manager = new_test_user(
            cls.env, login=BRANCH_LOGIN, password=BRANCH_PASSWORD, name='Branch finance manager',
            groups='liwan_core.group_employee', company_id=cls.branch.id, company_ids=[Command.set(cls.branch.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.branch_manager, [{
            'role_id': cls.env.ref('liwan_finance.role_finance_manager').id, 'company_id': cls.branch.id,
        }])

    def setUp(self):
        super().setUp()
        self.authenticate(BRANCH_LOGIN, BRANCH_PASSWORD)

    def get(self, path):
        result = self.api('GET', path)
        self.assertEqual(result.status_code, 200, f'{path}: {result.text}')
        return result.json()

    def test_the_branch_lists_the_parent_chart(self):
        accounts = self.get(f'{ACCOUNTS}?limit=100')
        parent = self.env['account.account'].search_count([('company_ids', 'in', self.company.ids)])
        self.assertGreater(parent, 0)
        As = self.env['account.account'].with_user(self.branch_manager).with_company(self.branch)
        debug = (
            self.branch.parent_id.id, self.branch.parent_path, self.company.id, self.company.parent_path,
            self.env['account.account'].search_count([('company_ids', 'parent_of', self.branch.ids)]),
            As.search_count([]), As.env.companies.ids, self.branch_manager.company_ids.ids,
        )
        self.assertEqual(accounts['total'], parent, debug)
        self.assertEqual(self.get(SETUP)['chart']['accounts_count'], parent)
        opened = self.api('GET', f'{ACCOUNTS}/{accounts["items"][0]["id"]}')
        self.assertEqual(opened.status_code, 200, opened.text)

    def test_the_branch_makes_a_journal_and_reads_it_back(self):
        created = self.api('POST', JOURNALS, json={'name': 'Branch sales', 'code': 'BRS', 'type': 'sale'})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.api('GET', f'{JOURNALS}/{created.json()["id"]}').status_code, 200)

    def test_the_branch_invoices_pays_and_reports_on_the_shared_chart(self):
        partner = self.api('POST', PARTNERS, json={'name': 'Branch customer', 'customer': True})
        self.assertEqual(partner.status_code, 201, partner.text)
        invoice = self.api('POST', INVOICES, json={
            'move_type': 'out_invoice', 'partner_id': partner.json()['id'], 'invoice_date': '2026-10-18',
            'lines': [{'name': 'Branch service', 'quantity': 1, 'price_unit': 200, 'tax_ids': []}],
        })
        self.assertEqual(invoice.status_code, 201, invoice.text)
        posted = self.api('POST', f'{INVOICES}/{invoice.json()["id"]}/post', json={})
        self.assertEqual(posted.status_code, 200, posted.text)
        journal = self.env['account.journal'].search([('company_id', '=', self.branch.id), ('type', '=', 'bank')], limit=1)
        payment = self.api('POST', f'{PAYMENTS}/standalone', json={
            'payment_type': 'inbound', 'partner_id': partner.json()['id'], 'amount': 50, 'payment_date': '2026-10-19',
            'journal_id': journal.id,
        })
        self.assertEqual(payment.status_code, 201, payment.text)
        self.assertEqual(self.api('GET', TRIAL_BALANCE).status_code, 200)

    def test_the_branch_sees_only_its_own_entries(self):
        branch_ids = {item['id'] for item in self.get(f'{INVOICES}?limit=100')['items']}
        self.assertNotIn(self.invoice.id, branch_ids)
        self.assertEqual(self.api('GET', f'{INVOICES}/{self.invoice.id}').status_code, 404)
        self.assertNotIn(self.other_payment.id, [item['id'] for item in self.get(f'{PAYMENTS}?limit=100')['items']])
        self.assertEqual(self.api('POST', f'{PAYMENTS}/{self.other_payment.id}/cancel').status_code, 404)

    def test_an_account_made_in_the_branch_joins_the_shared_chart(self):
        created = self.api('POST', ACCOUNTS, json={'code': '600977', 'name': 'Shared by branches', 'account_type': 'expense'})
        self.assertEqual(created.status_code, 201, created.text)
        account = self.env['account.account'].browse(created.json()['id'])
        self.assertEqual(account.company_ids, self.company)
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        self.assertEqual(self.api('GET', f'{ACCOUNTS}/{account.id}').status_code, 200)
