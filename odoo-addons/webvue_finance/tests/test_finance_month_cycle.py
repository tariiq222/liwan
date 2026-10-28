# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A whole month of a small company, run through the WebVue routes, against figures worked out by hand.

The expected numbers are in the docstring of the test; an accountant can check them without running anything. The only
shortcut is ZATCA: the sales journals of the fresh company are taken off the e-invoicing format (as the fixtures of this
addon do), because a Saudi sales invoice cannot be posted before a journal is onboarded to the ZATCA sandbox.
"""
from odoo import Command
from odoo.tests import tagged

from .common import WebVueFinanceCase

LOGIN = 'finance_month_cycle_manager'
PASSWORD = 'finance_month_cycle_pass_123'
API = '/api/v1/finance'
OCTOBER = 'date_from=2026-10-01&date_to=2026-10-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceMonthCycle(WebVueFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.fresh = cls._fresh_company_manager('Finance Month Cycle', LOGIN, PASSWORD)

    def call(self, method, path, body=None, status=200):
        result = self.api(method, f'{API}{path}', json=body)
        self.assertEqual(result.status_code, status, f'{method} {path}: {result.text}')
        return result.json()

    def figures(self, report):
        return {line['code']: line['value'] for line in report['lines']}

    def test_october_from_opening_balances_to_the_reports(self):
        """Opening balances at 2026-09-30: bank 50000, customer Noor owes 20000, we owe vendor Gulf 8000, capital 62000.

        October: sale 10000 + 15% = 11500; credit note 1000 + 15% = 1150; bill 4000 + 15% = 4600; customer advance 3000
        set against the sale; the bank statement shows +3000 (the advance), -2000 (part of the bill) and -25 (bank fee).

        Results: revenue 9000, expenses 4000 + 25, net profit 4975; bank 50000 + 3000 - 2000 - 25 = 50975;
        VAT return: box 1 base 9000 tax 1350, box 7 base 4000 tax 600, net VAT 750; cash: opening 50000, closing 50975.
        """
        self.authenticate(LOGIN, PASSWORD)
        zatca = self.env.ref('l10n_sa_edi.edi_sa_zatca')
        self.env['account.journal'].search([('company_id', '=', self.fresh.id)]).edi_format_ids = [Command.unlink(zatca.id)]
        Account = self.env['account.account'].with_company(self.fresh)
        journals = self.env['account.journal'].search([('company_id', '=', self.fresh.id)])
        bank = journals.filtered(lambda journal: journal.type == 'bank')[:1]
        misc = journals.filtered(lambda journal: journal.type == 'general')[:1]
        bank_account = bank.default_account_id
        receivable = Account.search([('account_type', '=', 'asset_receivable'), ('company_ids', 'in', self.fresh.ids)], limit=1)
        payable = Account.search([('account_type', '=', 'liability_payable'), ('company_ids', 'in', self.fresh.ids)], limit=1)
        capital = Account.browse(self.call('POST', '/accounts', {'code': '310900', 'name': 'Share capital', 'account_type': 'equity'}, 201)['id'])
        fees = Account.search([('account_type', '=', 'expense'), ('company_ids', 'in', self.fresh.ids)], limit=1)
        customer = self.call('POST', '/partners', {'name': 'Noor Trading', 'customer': True}, 201)
        vendor = self.call('POST', '/partners', {'name': 'Gulf Supplies', 'vendor': True}, 201)
        taxes = self.call('GET', '/taxes?q=15')['items']
        sale_vat = next(tax['id'] for tax in taxes if tax['type_tax_use'] == 'sale' and tax['amount'] == 15)
        purchase_vat = next(tax['id'] for tax in taxes if tax['type_tax_use'] == 'purchase' and tax['amount'] == 15)

        # 1. Opening balances: one posted entry in the miscellaneous journal.
        opening = self.call('POST', '/entries', {'journal_id': misc.id, 'date': '2026-09-30', 'ref': 'Opening balances', 'lines': [
            {'account_id': bank_account.id, 'name': 'Bank', 'debit': 50000, 'credit': 0},
            {'account_id': receivable.id, 'partner_id': customer['id'], 'name': 'Noor Trading', 'debit': 20000, 'credit': 0},
            {'account_id': payable.id, 'partner_id': vendor['id'], 'name': 'Gulf Supplies', 'debit': 0, 'credit': 8000},
            {'account_id': capital.id, 'name': 'Capital', 'debit': 0, 'credit': 62000},
        ]}, 201)
        self.call('POST', f'/entries/{opening["id"]}/post')

        # 2. Sales, a return and a purchase.
        sale = self.call('POST', '/invoices', {'move_type': 'out_invoice', 'partner_id': customer['id'], 'invoice_date': '2026-10-05', 'lines': [
            {'name': 'Consulting', 'quantity': 1, 'price_unit': 10000, 'tax_ids': [sale_vat]}]}, 201)
        sale = self.call('POST', f'/invoices/{sale["id"]}/post')
        note = self.call('POST', '/invoices', {'move_type': 'out_refund', 'partner_id': customer['id'], 'invoice_date': '2026-10-12', 'lines': [
            {'name': 'Return', 'quantity': 1, 'price_unit': 1000, 'tax_ids': [sale_vat]}]}, 201)
        note = self.call('POST', f'/invoices/{note["id"]}/post')
        bill = self.call('POST', '/invoices', {'move_type': 'in_invoice', 'partner_id': vendor['id'], 'invoice_date': '2026-10-08', 'lines': [
            {'name': 'Supplies', 'quantity': 1, 'price_unit': 4000, 'tax_ids': [purchase_vat]}]}, 201)
        bill = self.call('POST', f'/invoices/{bill["id"]}/post')
        self.assertEqual((sale['amount_total'], note['amount_total'], bill['amount_total']), (11500, 1150, 4600))

        # 3. A customer advance, set against the sale.
        advance = self.call('POST', '/payments/standalone', {
            'payment_type': 'inbound', 'partner_id': customer['id'], 'amount': 3000, 'payment_date': '2026-10-15', 'journal_id': bank.id,
        }, 201)
        self.assertEqual(advance['unallocated'], 3000)
        settled = self.call('POST', f'/payments/{advance["id"]}/allocate', {'invoice_ids': [sale['id']]})
        self.assertEqual(settled['unallocated'], 0)
        self.assertEqual(self.call('GET', f'/invoices/{sale["id"]}')['amount_residual'], 8500)

        # 4. Part of the bill is paid.
        paid = self.call('POST', '/payments', {'invoice_ids': [bill['id']], 'amount': 2000, 'payment_date': '2026-10-20', 'journal_id': bank.id}, 201)
        self.assertEqual(paid['amount'], 2000)
        self.assertEqual(self.call('GET', f'/invoices/{bill["id"]}')['amount_residual'], 2600)

        # 5. Two reports that must agree with the books.
        profit = self.figures(self.call('GET', f'/reports/profit-loss?{OCTOBER}'))
        self.assertEqual((profit['revenue'], profit['net_profit']), (9000, 5000))
        vat = {box['code']: box for box in self.call('GET', f'/reports/vat-return?{OCTOBER}')['boxes']}
        self.assertEqual((vat['sa_1']['base'], vat['sa_1']['tax']), (9000, 1350))
        self.assertEqual((vat['sa_7']['base'], vat['sa_7']['tax']), (4000, 600))
        self.assertEqual(vat['sa_16']['tax'], 750)

        # 6. The bank statement of the month, reconciled: the fee goes to an expense account.
        statement = self.call('POST', '/bank-statements/import', {
            'journal_id': bank.id, 'balance_start': 50000, 'balance_end_real': 50975,
            'content': 'Date,Description,Amount\n2026-10-15,Advance Noor,3000\n2026-10-20,Gulf Supplies,-2000\n2026-10-31,Bank fee,-25\n',
            'mapping': {'date': 'Date', 'payment_ref': 'Description', 'amount': 'Amount'},
        }, 201)
        self.assertEqual((statement['lines_count'], statement['balance_end']), (3, 50975))
        fee_line = next(line for line in statement['lines'] if line['payment_ref'] == 'Bank fee')
        self.call('POST', f'/bank-statement-lines/{fee_line["id"]}/reconcile', {'account_id': fees.id, 'label': 'Bank fee'})

        # 7. The closing figures.
        flow = self.call('GET', f'/reports/cash-flow?{OCTOBER}')
        self.assertEqual((flow['opening_cash'], flow['difference']), (50000, 0))
        profit = self.figures(self.call('GET', f'/reports/profit-loss?{OCTOBER}'))
        self.assertEqual(profit['net_profit'], 4975)
        trial = self.call('GET', f'/reports/trial-balance?{OCTOBER}')
        self.assertEqual(trial['totals']['debit'], trial['totals']['credit'])
        sheet = self.figures(self.call('GET', '/reports/balance-sheet?date_to=2026-10-31'))
        self.assertEqual(sheet['difference'], 0)
        aged = self.call('GET', '/reports/aged-partner-balance?date_to=2026-10-31&kind=receivable')
        self.assertEqual(aged['totals']['total'], 20000 + 8500 - 1150)
        self.assertEqual(self.call('GET', f'/invoices/{sale["id"]}')['payment_state'], 'partial')
