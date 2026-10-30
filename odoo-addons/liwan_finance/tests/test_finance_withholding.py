# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import (
    MANAGER_LOGIN,
    MANAGER_PASSWORD,
    OUTSIDER_LOGIN,
    OUTSIDER_PASSWORD,
    LiwanFinanceCase,
)
from odoo.addons.liwan_api.tests.common import set_probe_feature

REPORT = '/api/v1/finance/reports/withholding'
PERIOD = '?date_from=2026-10-01&date_to=2026-10-31'
BODY_KEYS = {'date_from', 'date_to', 'currency', 'taxes', 'base', 'withheld'}
ROW_KEYS = {'tax', 'rate', 'base', 'withheld'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceWithholdingReport(LiwanFinanceCase):
    """Vendor bills paid with the Saudi withholding taxes of the stock chart, in each company.

    A deducted (D) tax is withheld by the payment itself; a gross (G) tax is a cash-basis tax of the
    bill that is recognized when the bill is paid.
    """

    @classmethod
    def _tax(cls, company, name):
        tax = cls.env['account.tax'].with_context(active_test=False).search([
            ('company_id', '=', company.id), ('name', '=', name),
        ])
        # The stock chart ships the deducted taxes archived.
        tax.active = True
        return tax

    @classmethod
    def _prepare_company(cls, company):
        company.withholding_tax_base_account_id = cls.env['account.account'].create({
            'name': 'Withholding base', 'code': '999901', 'account_type': 'asset_current',
            'company_ids': [Command.link(company.id)],
        })

    @classmethod
    def _bill(cls, company, price, tax=None, day='2026-10-05'):
        bill = cls.env['account.move'].with_company(company).create({
            'move_type': 'in_invoice', 'partner_id': cls.partner.id, 'invoice_date': day, 'date': day,
            'invoice_line_ids': [Command.create({
                'name': 'Services', 'quantity': 1, 'price_unit': price, 'tax_ids': [Command.set(tax.ids if tax else [])],
            })],
        })
        bill.action_post()
        return bill

    @classmethod
    def _pay(cls, bill, day='2026-10-10', withholding=None, number='WH-1'):
        """Pay the whole bill; a ``withholding`` tax is withheld from it by a payment withholding line."""
        company = bill.company_id
        journal = cls.env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'bank')], limit=1)
        wizard = cls.env['account.payment.register'].with_company(company).with_context(
            active_model='account.move', active_ids=bill.ids,
        ).create({
            'amount': bill.amount_total, 'payment_date': day, 'journal_id': journal.id,
            'withholding_line_ids': [Command.create({
                'tax_id': withholding.id, 'name': number, 'base_amount': bill.amount_untaxed,
            })] if withholding else [],
        })
        return wizard._create_payments()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for company in (cls.company, cls.other_company):
            cls._prepare_company(company)
        cls.rent_5 = cls._tax(cls.company, '5% WH R D')
        cls.royalty_15 = cls._tax(cls.company, '15% WH R D')
        cls.management_20 = cls._tax(cls.company, '20% WH MF D')
        cls.rent_5_gross = cls._tax(cls.company, '5% WH R G')

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _report(self, query=PERIOD):
        result = self.api('GET', REPORT + query)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _rows(self, body):
        return {row['tax']['id']: row for row in body['taxes']}

    def test_a_period_without_withholding_is_empty(self):
        body = self._report()
        self.assertEqual(set(body), BODY_KEYS)
        self.assertEqual((body['date_from'], body['date_to'], body['currency']), ('2026-10-01', '2026-10-31', 'SAR'))
        self.assertEqual((body['taxes'], body['base'], body['withheld']), ([], 0, 0))

    def test_payments_withholding_5_15_and_20_percent_report_base_and_withheld_per_tax(self):
        self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-1')
        self._pay(self._bill(self.company, 2000), withholding=self.royalty_15, number='R-2')
        self._pay(self._bill(self.company, 500), withholding=self.management_20, number='R-3')
        body = self._report()
        rows = self._rows(body)
        self.assertEqual(set(rows), {self.rent_5.id, self.royalty_15.id, self.management_20.id})
        self.assertEqual(
            [(row['rate'], row['base'], row['withheld']) for row in body['taxes']],
            [(5, 1000, 50), (15, 2000, 300), (20, 500, 100)],
        )
        for row in body['taxes']:
            self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(rows[self.rent_5.id]['tax'], {'id': self.rent_5.id, 'name': '5% WH R D'})
        self.assertEqual((body['base'], body['withheld']), (3500, 450))

    def test_payments_of_the_same_tax_are_added_up(self):
        self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-1')
        self._pay(self._bill(self.company, 400), withholding=self.rent_5, number='R-2', day='2026-10-30')
        row = self._rows(self._report())[self.rent_5.id]
        self.assertEqual((row['base'], row['withheld']), (1400, 70))

    def test_a_gross_cash_basis_tax_counts_when_the_bill_is_paid(self):
        bill = self._bill(self.company, 1000, tax=self.rent_5_gross)
        self.assertEqual(self._report()['taxes'], [])
        self._pay(bill)
        row = self._rows(self._report())[self.rent_5_gross.id]
        self.assertEqual((row['rate'], row['base'], row['withheld']), (5, 1000, 52.63))

    def test_payments_outside_the_period_unpaid_gross_bills_and_cancelled_payments_are_not_counted(self):
        paid = self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-1')
        self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-2', day='2026-09-30')
        self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-3', day='2026-11-01')
        self._bill(self.company, 1000, tax=self.rent_5_gross)
        row = self._rows(self._report())[self.rent_5.id]
        self.assertEqual((row['base'], row['withheld']), (1000, 50))
        self.assertEqual(len(self._report()['taxes']), 1)
        paid.action_cancel()
        self.assertEqual(self._report()['taxes'], [])

    def test_a_reversed_payment_withholds_nothing(self):
        payment = self._pay(self._bill(self.company, 1000), withholding=self.rent_5, number='R-1')
        payment.move_id._reverse_moves([{'date': '2026-10-12'}], cancel=True)
        body = self._report()
        self.assertEqual((body['base'], body['withheld']), (0, 0))

    def test_only_the_current_company_is_reported(self):
        other_tax = self._tax(self.other_company, '5% WH R D')
        self._pay(self._bill(self.other_company, 1000), withholding=other_tax, number='O-1')
        self.assertEqual(self._report()['taxes'], [])
        self._pay(self._bill(self.company, 100), withholding=self.rent_5, number='R-1')
        self.assertEqual(self._report()['withheld'], 5)

    def test_vendor_vat_is_not_withholding(self):
        self._bill(self.company, 400, tax=self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'purchase'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1))
        self.assertEqual(self._report()['taxes'], [])

    def test_the_period_is_required_and_valid(self):
        for query in (
            '', '?date_from=2026-10-01', '?date_to=2026-10-31', '?date_from=x&date_to=2026-10-31',
            '?date_from=2026-11-01&date_to=2026-10-01',
        ):
            with self.subTest(query=query):
                result = self.api('GET', REPORT + query)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_a_user_without_reports_read_gets_403_forbidden(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        result = self.api('GET', REPORT + PERIOD)
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_a_closed_finance_feature_refuses_the_report(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.assertEqual(self.api('GET', REPORT + PERIOD).status_code, 403)
