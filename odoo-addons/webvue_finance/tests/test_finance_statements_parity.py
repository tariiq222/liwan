# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import Command
from odoo.tests import tagged

from .oca_common import REPORTS, WebVueFinanceOcaCase
from .oca_reference import oca_aged_partner_balance, oca_general_ledger

OCA_BUCKETS = (
    ('current', 'current'), ('days_1_30', '30_days'), ('days_31_60', '60_days'),
    ('days_61_90', '90_days'), ('days_91_120', '120_days'), ('days_over_120', 'older'),
)
LEDGER_PERIODS = (
    (date(2026, 1, 1), date(2026, 12, 31)),
    (date(2026, 3, 1), date(2026, 9, 30)),   # opening balances from earlier in the fiscal year
    (date(2026, 10, 19), date(2026, 10, 31)),
    (date(2027, 1, 1), date(2027, 3, 31)),   # the whole of 2026 profit and loss is an earlier fiscal year
)
AGED_DATES = (date(2026, 7, 15), date(2026, 10, 18), date(2026, 10, 20), date(2026, 11, 30), date(2027, 6, 30))
RECEIVABLE, PAYABLE = 'asset_receivable', 'liability_payable'
QUERIES_OF_A_LEDGER_PAGE = 6
QUERIES_OF_AN_AGED_BALANCE = 14


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceStatementsParity(WebVueFinanceOcaCase):
    """The SQL general ledger and aged partner balance give the numbers of the OCA engines."""

    @classmethod
    def _invoice(cls, move_type, partner, amount, day, due):
        move = cls.env['account.move'].with_company(cls.company).create({
            'move_type': move_type, 'partner_id': partner.id, 'invoice_date': day, 'invoice_date_due': due,
            'invoice_line_ids': [Command.create({
                'name': 'Item', 'quantity': 1, 'price_unit': amount,
                'tax_ids': [Command.set((cls.purchase_vat if move_type.startswith('in_') else cls.sale_vat).ids)],
            })],
        })
        move.action_post()
        return move

    @classmethod
    def _pay(cls, move, amount, day):
        cls.env['account.payment.register'].with_context(
            active_model='account.move', active_ids=move.ids,
        ).create({'amount': amount, 'payment_date': day, 'journal_id': cls.bank.id}).action_create_payments()

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.basma = cls.env['res.partner'].create({'name': 'Basma Contracting'})
        old = cls._invoice('out_invoice', cls.basma, 800, '2026-03-10', '2026-04-10')
        cls._pay(old, 300, '2026-05-02')
        cls._pay(old, 200, '2026-10-25')    # after most of the aged dates
        mid = cls._invoice('out_invoice', cls.basma, 500, '2026-06-01', '2026-07-01')
        cls._invoice('out_refund', cls.basma, 100, '2026-08-01', '2026-08-01')    # a credit note, unmatched
        cls._invoice('out_invoice', cls.riyadh, 40, '2026-10-19', '2026-10-19')
        cls._pay(mid, 575, '2026-07-20')
        old_bill = cls._invoice('in_invoice', cls.vendor, 600, '2026-04-01', '2026-05-01')
        cls._pay(old_bill, 100, '2026-04-20')
        cls._invoice('in_invoice', cls.riyadh, 50, '2026-09-01', '2026-09-30')
        cls.entry('2026-06-15', [('102011', 75, 0), ('400064', 0, 75)])   # a receivable item with no partner
        cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'date': '2026-11-02', 'journal_id': cls._journal(cls.company, 'general').id,
            'line_ids': [
                Command.create({'account_id': cls.account('101001').id, 'debit': 9, 'credit': 0}),
                Command.create({'account_id': cls.account('300001').id, 'debit': 0, 'credit': 9}),
            ],
        })   # a draft entry, only in the target_move=all figures

    def _model(self):
        return self.env['webvue.finance.statement.report'].with_company(self.company)

    # --- general ledger ---------------------------------------------------------------------------------

    def _oca_ledger(self, date_from, date_to, only_posted, **filters):
        return {
            row['code']: {
                'initial_balance': row['init_bal']['balance'],
                'debit': sum(line['debit'] for line in row['move_lines']),
                'credit': sum(line['credit'] for line in row['move_lines']),
                'ending_balance': row['fin_bal']['balance'],
                'lines': [(line['id'], line['debit'], line['credit'], line['balance']) for line in row['move_lines']],
            }
            for row in oca_general_ledger(self.company, date_from, date_to, only_posted, **filters)
        }

    def _sql_ledger(self, date_from, date_to, only_posted, limit=0, offset=0, **filters):
        rows = self._model()._webvue_general_ledger(self.company, date_from, date_to, only_posted, limit=limit, offset=offset, **filters)
        return {row['account'].code: row for row in rows}

    def assertLedgerTotals(self, sql, oca, message):
        self.assertEqual(set(sql), set(oca), message)
        for code, expected in oca.items():
            for key in ('initial_balance', 'debit', 'credit', 'ending_balance'):
                self.assertAlmostEqual(sql[code][key], expected[key], places=2, msg=f'{message} {code} {key}')
            self.assertEqual(sql[code]['total'], len(expected['lines']), f'{message} {code} count')

    def test_the_ledger_totals_equal_the_oca_engine(self):
        for date_from, date_to in LEDGER_PERIODS:
            for only_posted in (True, False):
                with self.subTest(date_from=date_from, date_to=date_to, only_posted=only_posted):
                    oca = self._oca_ledger(date_from, date_to, only_posted)
                    self.assertLedgerTotals(self._sql_ledger(date_from, date_to, only_posted), oca, 'all accounts')

    def test_the_ledger_lines_and_running_balances_equal_the_oca_engine(self):
        for date_from, date_to in LEDGER_PERIODS:
            for account in (self.account('101001'), self.account('102011'), self.account('400064')):
                with self.subTest(date_from=date_from, date_to=date_to, account=account.code):
                    oca = self._oca_ledger(date_from, date_to, True, account=account)
                    sql = self._sql_ledger(date_from, date_to, True, limit=1000, account=account)
                    self.assertLedgerTotals(sql, oca, account.code)
                    for code, expected in oca.items():
                        # the same items; same-day ties may sort differently, so the balances are checked as a
                        # running sum of our own order that ends where the engine's does
                        entries = sql[code]['lines']
                        self.assertEqual(
                            sorted((e['line'].id, e['line'].debit, e['line'].credit) for e in entries),
                            sorted(line[:3] for line in expected['lines']),
                        )
                        balance = sql[code]['initial_balance']
                        for entry in entries:
                            balance += entry['line'].balance
                            self.assertAlmostEqual(entry['balance'], balance, places=2)
                        self.assertAlmostEqual(balance, expected['ending_balance'], places=2)

    def test_pages_of_the_ledger_continue_the_running_balance(self):
        account = self.account('102011')
        full = self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True, limit=1000, account=account)['102011']['lines']
        self.assertGreater(len(full), 6)
        paged = []
        for offset in range(0, len(full), 2):
            page = self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True, limit=2, offset=offset, account=account)
            paged += page['102011']['lines']
        self.assertEqual([(e['line'].id, e['balance']) for e in paged], [(e['line'].id, e['balance']) for e in full])
        beyond = self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True, limit=2, offset=1000, account=account)
        self.assertEqual((beyond['102011']['lines'], beyond['102011']['total']), ([], len(full)))

    def test_the_ledger_of_one_partner_equals_the_oca_engine(self):
        for partner in (self.basma, self.riyadh):
            with self.subTest(partner=partner.name):
                oca = self._oca_ledger(date(2026, 3, 1), date(2026, 12, 31), True, partner=partner)
                self.assertLedgerTotals(self._sql_ledger(date(2026, 3, 1), date(2026, 12, 31), True, partner=partner), oca, partner.name)

    # --- aged partner balance ---------------------------------------------------------------------------

    def _oca_aged(self, date_at, account_type, only_posted=True, partner=None):
        return {
            (account['code'], partner_row['name']): {key: partner_row[oca] for key, oca in OCA_BUCKETS} | {'total': partner_row['residual']}
            for account in oca_aged_partner_balance(self.company, date_at, only_posted, account_type, partner)
            for partner_row in account['partners']
        }

    def _sql_aged(self, date_at, account_type, only_posted=True, partner=None):
        result = {}
        for account, found_partner, buckets in self._model()._webvue_aged_partner_balance(
            self.company, date_at, only_posted, account_type, partner,
        ):
            result[account.code, found_partner.display_name or ''] = {**buckets, 'total': sum(buckets.values())}
        return result

    def assertAgedEqual(self, sql, oca):
        # a row the SQL side holds at zero for every bucket is an item that nets out: the engine drops those
        sql = {key: row for key, row in sql.items() if any(abs(value) > 0.005 for value in row.values())}
        oca = {key: row for key, row in oca.items() if any(abs(value) > 0.005 for value in row.values())}
        self.assertEqual(set(sql), set(oca))
        for key, expected in oca.items():
            for bucket, value in expected.items():
                self.assertAlmostEqual(sql[key][bucket], value, places=2, msg=f'{key} {bucket}')

    def test_the_aged_receivables_equal_the_oca_engine(self):
        for date_at in AGED_DATES:
            for only_posted in (True, False):
                with self.subTest(date_at=date_at, only_posted=only_posted):
                    self.assertAgedEqual(
                        self._sql_aged(date_at, RECEIVABLE, only_posted), self._oca_aged(date_at, RECEIVABLE, only_posted),
                    )

    def test_the_aged_payables_equal_the_oca_engine(self):
        for date_at in AGED_DATES:
            with self.subTest(date_at=date_at):
                self.assertAgedEqual(self._sql_aged(date_at, PAYABLE), self._oca_aged(date_at, PAYABLE))

    def test_the_aged_balance_of_one_partner_equals_the_oca_engine(self):
        for partner in (self.basma, self.riyadh):
            with self.subTest(partner=partner.name):
                self.assertAgedEqual(
                    self._sql_aged(date(2026, 10, 18), RECEIVABLE, partner=partner),
                    self._oca_aged(date(2026, 10, 18), RECEIVABLE, partner=partner),
                )

    def test_an_item_reconciled_after_the_date_is_still_aged_there(self):
        rows = self._sql_aged(date(2026, 10, 18), RECEIVABLE)
        # Basma's 920 invoice (due 2026-04-10) lost 300 on 2026-05-02 and 200 on 2026-10-25, which is later;
        # her credit note of 115 is 78 days overdue
        basma = rows['102011', 'Basma Contracting']
        self.assertAlmostEqual(basma['days_over_120'], 620, places=2)
        self.assertAlmostEqual(basma['days_61_90'], -115, places=2)

    def test_a_payment_dated_after_the_date_is_still_open_on_it(self):
        # the 200 paid on 2026-10-25 is open on 2026-10-20
        rows = self._sql_aged(date(2026, 10, 20), RECEIVABLE)
        self.assertAlmostEqual(rows['102011', 'Basma Contracting']['days_over_120'], 620, places=2)

    # --- the unaffected earnings account, fiscal years and closing entries ------------------------------

    def test_the_ledger_of_the_earnings_account_alone_is_its_row_of_the_full_ledger(self):
        # deliberately unlike the OCA engine, which leaves the earlier years out when an account is named
        earnings = self.account('999999')
        for date_from, date_to in LEDGER_PERIODS:
            with self.subTest(date_from=date_from):
                alone = self._sql_ledger(date_from, date_to, True, limit=1000, account=earnings)['999999']
                full = self._sql_ledger(date_from, date_to, True)['999999']
                for key in ('initial_balance', 'debit', 'credit', 'ending_balance', 'total'):
                    self.assertAlmostEqual(alone[key], full[key], places=2)
        self.assertAlmostEqual(self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True, account=earnings)['999999']['initial_balance'], -5000)

    def test_a_ledger_follows_a_fiscal_year_that_ends_in_june(self):
        self.company.write({'fiscalyear_last_month': '6', 'fiscalyear_last_day': 30})
        for date_from, date_to in ((date(2026, 3, 1), date(2026, 12, 31)), (date(2026, 8, 1), date(2027, 2, 28)), (date(2026, 7, 1), date(2026, 7, 31))):
            with self.subTest(date_from=date_from):
                self.assertLedgerTotals(
                    self._sql_ledger(date_from, date_to, True), self._oca_ledger(date_from, date_to, True), 'june year',
                )

    def test_a_closed_year_shows_its_closing_entry_and_hands_its_result_to_the_earnings_account(self):
        before = self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True)
        result = self.api('POST', '/api/v1/finance/fiscal-years/2025/close', json={})
        self.assertEqual(result.status_code, 200, result.text)
        closing = self.env['account.move'].browse(result.json()['closing_entry']['id'])
        # the profit and loss account of 2025 carries the closing line, and so does the earnings account
        sales = self._sql_ledger(date(2025, 1, 1), date(2025, 12, 31), True, limit=1000, account=self.account('500001'))['500001']
        self.assertIn(closing.id, [e['line'].move_id.id for e in sales['lines']])
        self.assertAlmostEqual(sales['ending_balance'], 0)
        for date_from, date_to in ((date(2025, 1, 1), date(2025, 12, 31)), (date(2026, 1, 1), date(2026, 12, 31))):
            with self.subTest(date_from=date_from):
                self.assertLedgerTotals(
                    self._sql_ledger(date_from, date_to, True), self._oca_ledger(date_from, date_to, True), 'closed year',
                )
        after = self._sql_ledger(date(2026, 1, 1), date(2026, 12, 31), True)
        # the 2026 opening of the earnings account is minus the 5000 profit of 2025, closed or not
        self.assertAlmostEqual(after['999999']['initial_balance'], -5000)
        self.assertAlmostEqual(before['999999']['initial_balance'], after['999999']['initial_balance'])

    def test_pages_hold_across_items_without_an_entry_name(self):
        account = self.account('102011')
        for _ in range(2):
            self.env['account.move'].with_company(self.company).create({
                'move_type': 'entry', 'date': '2026-10-18', 'journal_id': self._journal(self.company, 'general').id,
                'line_ids': [
                    Command.create({'account_id': account.id, 'debit': 3, 'credit': 0, 'name': 'draft'}),
                    Command.create({'account_id': self.account('300001').id, 'debit': 0, 'credit': 3, 'name': 'draft'}),
                ],
            })
        nameless = self.env['account.move.line'].search([('account_id', '=', account.id), ('name', '=', 'draft'), ('debit', '=', 3)])
        self.env.cr.execute('UPDATE account_move_line SET move_name = NULL WHERE id = %s', [nameless[0].id])
        self.env['account.move.line'].invalidate_model(['move_name'])
        args = (self.company, date(2026, 1, 1), date(2026, 12, 31), False, account, None)
        full = self._model()._webvue_general_ledger(*args, 1000, 0)[0]['lines']
        self.assertIn(False, [bool(e['line'].move_name) for e in full])
        self.assertEqual(len({e['line'].date for e in full if e['line'].date == date(2026, 10, 18)}), 1)
        for size in (1, 2, 3):
            paged = []
            for offset in range(0, len(full), size):
                paged += self._model()._webvue_general_ledger(*args, size, offset)[0]['lines']
            self.assertEqual([(e['line'].id, e['balance']) for e in paged], [(e['line'].id, e['balance']) for e in full])

    # --- the API ----------------------------------------------------------------------------------------

    def test_the_routes_serve_the_same_figures(self):
        account = self.account('102011')
        query = f'?date_from=2026-03-01&date_to=2026-12-31&account_id={account.id}&limit=2&offset=1'
        result = self.api('GET', f'{REPORTS}/general-ledger{query}')
        self.assertEqual(result.status_code, 200, result.text)
        oca = self._oca_ledger(date(2026, 3, 1), date(2026, 12, 31), True, account=account)['102011']
        body = result.json()['accounts'][0]
        self.assertEqual(body['lines']['total'], len(oca['lines']))
        self.assertEqual(
            [line['balance'] for line in body['lines']['items']], [round(line[3], 2) for line in oca['lines'][1:3]],
        )

    def test_a_ledger_page_costs_a_bounded_number_of_queries(self):
        account = self.account('102011')
        model = self._model()
        args = (self.company, date(2026, 1, 1), date(2026, 12, 31), True, account, None)
        model._webvue_general_ledger(*args, 2, 2)    # warm what the routes share
        # the opening and period sums, the page and the sum before it, whatever the number of lines
        with self.assertQueryCount(QUERIES_OF_A_LEDGER_PAGE):
            rows = model._webvue_general_ledger(*args, 2, 2)
            [(entry['line'].journal_id.code, entry['line'].partner_id.display_name) for entry in rows[0]['lines']]

    def test_an_aged_balance_costs_a_bounded_number_of_queries(self):
        model = self._model()
        args = (self.company, date(2026, 10, 18), True, RECEIVABLE)
        model._webvue_aged_partner_balance(*args)    # warm what the routes share
        # one sum per bucket, the two sums of the later reconciliations and the few items they touched
        with self.assertQueryCount(QUERIES_OF_AN_AGED_BALANCE):
            [(account.code, partner.display_name) for account, partner, _buckets in model._webvue_aged_partner_balance(*args)]
