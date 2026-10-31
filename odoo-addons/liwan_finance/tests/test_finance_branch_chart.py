# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A branch uses its parent's chart of accounts and sees only its own entries (owner decision 2026-10-31, issue #200)."""
from odoo import Command
from odoo.tests import new_test_user, tagged

from .write_common import INVOICES, PARTNERS, PAYMENTS, LiwanFinanceWriteCase

ACCOUNTS = '/api/v1/finance/accounts'
JOURNALS = '/api/v1/finance/journals'
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
        zatca = cls.env.ref('l10n_sa_edi.edi_sa_zatca')
        cls.env['account.journal'].search([('company_id', '=', cls.branch.id)]).edi_format_ids = [Command.unlink(zatca.id)]
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
        # The shared chart plus the liquidity account of the branch's own bank journal.
        parent += self.env['account.account'].search_count([('company_ids', 'in', self.branch.ids)])
        self.assertEqual(accounts['total'], parent)
        self.assertEqual(self.get(SETUP)['chart']['accounts_count'], parent)
        opened = self.api('GET', f'{ACCOUNTS}/{accounts["items"][0]["id"]}')
        self.assertEqual(opened.status_code, 200, opened.text)

    def test_the_branch_makes_a_journal_and_reads_it_back(self):
        created = self.api('POST', JOURNALS, json={'name': 'Branch sales', 'code': 'BRS', 'type': 'sale'})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(self.api('GET', f'{JOURNALS}/{created.json()["id"]}').status_code, 200)

    def test_a_new_branch_gets_its_own_journals_over_the_shared_chart(self):
        journals = self.env['account.journal'].search([('company_id', '=', self.branch.id)])
        root_types = set(self.env['account.journal'].search([('company_id', '=', self.company.id)]).mapped('type'))
        self.assertEqual(set(journals.mapped('type')), root_types & {'sale', 'purchase', 'general', 'bank', 'cash'})
        self.assertIn('bank', root_types)
        bank = journals.filtered(lambda journal: journal.type == 'bank')
        self.assertNotIn(bank.default_account_id, self.env['account.journal'].search([('company_id', '=', self.company.id)]).default_account_id)
        receipts = self.env.ref(f'account.{self.company.id}_account_journal_payment_debit_account_id')
        self.assertEqual(bank.inbound_payment_method_line_ids.payment_account_id, receipts)
        listed = self.get(JOURNALS)['items']
        self.assertEqual({item['id'] for item in listed}, set(journals.ids))

    def test_an_existing_branch_without_journals_is_provisioned_once_by_the_migration_step(self):
        # The upgrade step calls exactly this method on every branch (migrations/19.0.1.4.5).
        journals = self.env['account.journal'].search([('company_id', '=', self.branch.id)])
        types = set(journals.mapped('type'))
        journals.unlink()
        self.branch._liwan_provision_branch_journals()
        again = self.env['account.journal'].search([('company_id', '=', self.branch.id)])
        self.assertEqual(set(again.mapped('type')), types)
        self.branch._liwan_provision_branch_journals()
        self.assertEqual(self.env['account.journal'].search([('company_id', '=', self.branch.id)]), again)

    def test_the_branch_invoices_pays_and_reports_on_the_shared_chart(self):
        partner = self.api('POST', PARTNERS, json={'name': 'Branch customer', 'customer': True})
        self.assertEqual(partner.status_code, 201, partner.text)
        invoice = self.api('POST', INVOICES, json={
            'move_type': 'out_invoice', 'partner_id': partner.json()['id'], 'invoice_date': '2026-10-18',
            'lines': [{'name': 'Branch service', 'quantity': 1, 'price_unit': 200, 'tax_ids': []}],
        })
        self.assertEqual(invoice.status_code, 201, invoice.text)
        self.assertEqual(self.env['account.move'].browse(invoice.json()['id']).journal_id.company_id, self.branch)
        # Posting a Saudi sale document needs the branch's ZATCA onboarding, which is not what this test is about.
        bank = self.env['account.journal'].search([('company_id', '=', self.branch.id), ('type', '=', 'bank')], limit=1)
        payment = self.api('POST', f'{PAYMENTS}/standalone', json={
            'payment_type': 'inbound', 'partner_id': partner.json()['id'], 'amount': 50, 'payment_date': '2026-10-19',
            'journal_id': bank.id,
        })
        self.assertEqual(payment.status_code, 201, payment.text)
        self.assertEqual(self.api('GET', TRIAL_BALANCE).status_code, 200)

    def test_a_branch_whose_journals_are_gone_is_told_to_create_one_not_refused_with_odoo_text(self):
        self.env['account.journal'].search([('company_id', '=', self.branch.id), ('type', '=', 'sale')]).unlink()
        result = self.api('POST', INVOICES, json={
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'lines': [{'name': 'Service', 'quantity': 1, 'price_unit': 10, 'tax_ids': []}],
        })
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'no_journal', 'journal_id'))

    def test_the_branch_sees_only_its_own_entries(self):
        branch_ids = {item['id'] for item in self.get(f'{INVOICES}?limit=100')['items']}
        self.assertNotIn(self.invoice.id, branch_ids)
        self.assertEqual(self.api('GET', f'{INVOICES}/{self.invoice.id}').status_code, 404)
        self.assertNotIn(self.other_payment.id, [item['id'] for item in self.get(f'{PAYMENTS}?limit=100')['items']])
        self.assertEqual(self.api('POST', f'{PAYMENTS}/{self.other_payment.id}/cancel').status_code, 404)

    def test_the_branch_reads_the_parent_chart_but_cannot_change_it(self):
        root_account = self.env['account.account'].search([('company_ids', 'in', self.company.ids), ('account_type', '=', 'expense')], limit=1)
        for method, path, body in (
            ('PATCH', f'{ACCOUNTS}/{root_account.id}', {'name': 'Renamed by a branch'}),
            ('POST', f'{ACCOUNTS}/{root_account.id}/archive', {}),
            ('POST', f'{ACCOUNTS}/{root_account.id}/unarchive', {}),
        ):
            with self.subTest(path=path):
                result = self.api(method, path, json=body)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'shared_record'), result.text)
        root_account.invalidate_recordset()
        self.assertTrue(root_account.active)
        self.assertNotEqual(root_account.name, 'Renamed by a branch')
        self.assertEqual(self.api('GET', f'{ACCOUNTS}/{root_account.id}').status_code, 200)

    def test_a_branch_invoice_may_use_an_account_of_the_parent_chart(self):
        income = self.env['account.account'].search([('company_ids', 'in', self.company.ids), ('account_type', '=', 'income')], limit=1)
        result = self.api('POST', INVOICES, json={
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'lines': [{'name': 'Parent account', 'quantity': 1, 'price_unit': 10, 'account_id': income.id, 'tax_ids': []}],
        })
        self.assertEqual(result.status_code, 201, result.text)

    def test_an_account_made_in_the_branch_belongs_to_the_branch_only(self):
        created = self.api('POST', ACCOUNTS, json={'code': '600977', 'name': 'Branch only', 'account_type': 'expense'})
        self.assertEqual(created.status_code, 201, created.text)
        account = self.env['account.account'].browse(created.json()['id'])
        self.assertEqual(account.company_ids, self.branch)
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        self.assertEqual(self.api('GET', f'{ACCOUNTS}/{account.id}').status_code, 404)
