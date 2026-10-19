# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .write_common import PASSWORD, WebVueFinanceWriteCase

ENTRIES = '/api/v1/finance/entries'


class EntryCase(WebVueFinanceWriteCase):

    @classmethod
    def _account(cls, company, account_type):
        return cls.env['account.account'].with_company(company).search([
            ('company_ids', 'in', company.id), ('account_type', '=', account_type),
        ], limit=1)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.general = cls._journal(cls.company, 'general')
        cls.other_general = cls._journal(cls.other_company, 'general')
        cls.expense = cls._account(cls.company, 'expense')
        cls.income = cls._account(cls.company, 'income')
        cls.receivable = cls._account(cls.company, 'asset_receivable')
        cls.other_expense = cls._account(cls.other_company, 'expense')

    def entry_body(self, **overrides):
        """A balanced 500 SAR entry: expense debit, income credit."""
        return {
            'journal_id': self.general.id,
            'date': '2026-10-18',
            'ref': 'ADJ-1',
            'lines': [
                {'account_id': self.expense.id, 'name': 'Rent', 'debit': 500},
                {'account_id': self.income.id, 'name': 'Rent', 'credit': 500},
            ],
            **overrides,
        }

    def create_entry(self, body=None):
        result = self.api('POST', ENTRIES, json=body or self.entry_body())
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def post_entry(self, entry_id):
        result = self.api('POST', f'{ENTRIES}/{entry_id}/post', json={})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceEntries(EntryCase):

    def test_create_returns_a_balanced_draft_with_its_lines(self):
        entry = self.create_entry()
        self.assertEqual((entry['state'], entry['ref'], entry['date'], entry['amount_total']), ('draft', 'ADJ-1', '2026-10-18', 500))
        self.assertEqual(entry['journal']['id'], self.general.id)
        self.assertEqual(
            sorted((line['account']['id'], line['debit'], line['credit']) for line in entry['lines']),
            sorted([(self.expense.id, 500, 0), (self.income.id, 0, 500)]),
        )
        self.assertEqual(self.env['account.move'].browse(entry['id']).move_type, 'entry')

    def test_a_line_may_name_a_partner(self):
        body = self.entry_body()
        body['lines'][0]['partner_id'] = self.partner.id
        entry = self.create_entry(body)
        self.assertIn(self.partner.id, [line['partner']['id'] for line in entry['lines'] if line['partner']])

    def test_get_and_list_with_filters(self):
        entry = self.create_entry()
        self.create_entry(self.entry_body(ref='OTHER', date='2026-09-01'))
        self.assertEqual(self.api('GET', f'{ENTRIES}/{entry["id"]}').json()['id'], entry['id'])
        listing = self.api('GET', ENTRIES).json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertGreaterEqual(listing['total'], 2)
        self.assertEqual(self.api('GET', f'{ENTRIES}?q=ADJ-1').json()['total'], 1)
        self.assertEqual(self.api('GET', f'{ENTRIES}?date_from=2026-10-01&date_to=2026-10-31').json()['total'], 1)
        self.assertEqual(self.api('GET', f'{ENTRIES}?state=posted').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{ENTRIES}?journal_id={self.general.id}&limit=1').json()['total'], 2)
        self.assertRefused(self.api('GET', f'{ENTRIES}?state=bogus'), 422, 'invalid', 'state')

    def test_post_then_reset_to_draft_then_delete(self):
        entry = self.create_entry()
        self.assertIsNone(entry['name'])
        posted = self.post_entry(entry['id'])
        self.assertEqual(posted['state'], 'posted')
        self.assertNotEqual(posted['name'], '/')
        self.assertRefused(self.api('POST', f'{ENTRIES}/{entry["id"]}/post', json={}), 422, 'not_draft')
        self.assertRefused(self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'ref': 'X'}), 422, 'not_draft')
        self.assertRefused(self.api('DELETE', f'{ENTRIES}/{entry["id"]}'), 422, 'not_draft')
        reset = self.api('POST', f'{ENTRIES}/{entry["id"]}/reset-to-draft', json={})
        self.assertEqual((reset.status_code, reset.json()['state']), (200, 'draft'))
        self.assertRefused(self.api('POST', f'{ENTRIES}/{entry["id"]}/reset-to-draft', json={}), 422, 'invalid_state')
        self.assertEqual(self.api('DELETE', f'{ENTRIES}/{entry["id"]}').status_code, 204)
        self.assertEqual(self.api('GET', f'{ENTRIES}/{entry["id"]}').status_code, 404)

    def test_patch_replaces_lines_only_when_the_body_carries_them(self):
        entry = self.create_entry()
        kept = self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'ref': 'NEW'}).json()
        self.assertEqual((kept['ref'], len(kept['lines'])), ('NEW', 2))
        lines = [
            {'account_id': self.expense.id, 'name': 'A', 'debit': 30},
            {'account_id': self.expense.id, 'name': 'B', 'debit': 70},
            {'account_id': self.income.id, 'name': 'C', 'credit': 100},
        ]
        replaced = self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'lines': lines}).json()
        self.assertEqual((len(replaced['lines']), replaced['amount_total']), (3, 100))
        self.assertRefused(self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={}), 422, 'invalid')

    def test_an_unbalanced_body_is_422_unbalanced_before_odoo_is_called(self):
        before = self.env['account.move'].search_count([])
        body = self.entry_body()
        body['lines'][1]['credit'] = 400
        result = self.api('POST', ENTRIES, json=body)
        self.assertRefused(result, 422, 'unbalanced', 'lines')
        self.assertEqual(result.json()['details'], {'debit': 500, 'credit': 400})
        self.assertEqual(self.env['account.move'].search_count([]), before)
        entry = self.create_entry()
        self.assertRefused(
            self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'lines': body['lines']}), 422, 'unbalanced',
        )

    def test_each_line_has_exactly_one_of_debit_or_credit_above_zero(self):
        for line, field in (
            ({'account_id': self.expense.id, 'name': 'x', 'debit': 5, 'credit': 5}, 'lines[0]'),
            ({'account_id': self.expense.id, 'name': 'x'}, 'lines[0]'),
            ({'account_id': self.expense.id, 'name': 'x', 'debit': -5}, 'lines[0].debit'),
            ({'account_id': self.expense.id, 'name': 'x', 'debit': '5'}, 'lines[0].debit'),
        ):
            with self.subTest(line=line):
                body = self.entry_body()
                body['lines'][0] = line
                self.assertRefused(self.api('POST', ENTRIES, json=body), 422, 'invalid', field)

    def test_the_body_is_strict(self):
        self.assertRefused(self.api('POST', ENTRIES, json=self.entry_body(move_type='out_invoice')), 422, 'invalid', 'move_type')
        self.assertRefused(self.api('POST', ENTRIES, json={'journal_id': self.general.id, 'date': '2026-10-18'}), 422, 'invalid', 'lines')
        self.assertRefused(self.api('POST', ENTRIES, json=self.entry_body(date='18/10/2026')), 422, 'invalid', 'date')
        body = self.entry_body()
        body['lines'][0]['tax_ids'] = []
        self.assertRefused(self.api('POST', ENTRIES, json=body), 422, 'invalid', 'lines[0].tax_ids')

    def test_the_journal_must_be_a_general_journal_of_the_company(self):
        self.assertRefused(self.api('POST', ENTRIES, json=self.entry_body(journal_id=self.bank.id)), 422, 'invalid', 'journal_id')
        self.assertRefused(self.api('POST', ENTRIES, json=self.entry_body(journal_id=self.other_general.id)), 422, 'invalid', 'journal_id')

    def test_accounts_and_partners_of_another_company_are_refused(self):
        body = self.entry_body()
        body['lines'][0]['account_id'] = self.other_expense.id
        self.assertRefused(self.api('POST', ENTRIES, json=body), 422, 'invalid', 'lines[0].account_id')
        body = self.entry_body()
        body['lines'][0]['partner_id'] = self.foreign_partner.id
        self.assertRefused(self.api('POST', ENTRIES, json=body), 422, 'invalid', 'lines[0].partner_id')

    def test_another_company_entry_is_404_on_every_route(self):
        other = self.env['account.move'].with_company(self.other_company).create({
            'move_type': 'entry', 'journal_id': self.other_general.id, 'date': '2026-10-18',
            'line_ids': [
                Command.create({'account_id': self.other_expense.id, 'debit': 10, 'name': 'x'}),
                Command.create({'account_id': self._account(self.other_company, 'income').id, 'credit': 10, 'name': 'x'}),
            ],
        })
        path = f'{ENTRIES}/{other.id}'
        for method, suffix in (('GET', ''), ('PATCH', ''), ('DELETE', ''), ('POST', '/post'), ('POST', '/reset-to-draft'), ('POST', '/unreconcile')):
            with self.subTest(method=method, suffix=suffix):
                self.assertEqual(self.api(method, path + suffix, json={'ref': 'x'}).status_code, 404)
        self.assertNotIn(other.id, [item['id'] for item in self.api('GET', ENTRIES).json()['items']])

    def test_invoices_payments_and_statement_entries_are_not_entries(self):
        generated = {
            'invoice': self.invoice,
            'payment': self.env['account.payment'].with_company(self.company).create({
                'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': self.partner.id,
                'amount': 10, 'date': '2026-10-18', 'journal_id': self.bank.id,
            }).move_id,
        }
        for name, move in generated.items():
            for method, suffix in (('GET', ''), ('PATCH', ''), ('DELETE', ''), ('POST', '/post'), ('POST', '/reset-to-draft'), ('POST', '/unreconcile')):
                with self.subTest(source=name, method=method, suffix=suffix):
                    self.assertEqual(self.api(method, f'{ENTRIES}/{move.id}{suffix}', json={'ref': 'x'}).status_code, 404)
        listed = [item['id'] for item in self.api('GET', f'{ENTRIES}?limit=100').json()['items']]
        self.assertFalse(set(listed) & {move.id for move in generated.values()})

    def test_a_date_in_a_locked_period_is_refused_up_front_as_period_locked(self):
        entry = self.create_entry()
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{ENTRIES}/{entry["id"]}/post', json={}), 422, 'period_locked', 'date')
        self.assertRefused(self.api('POST', ENTRIES, json=self.entry_body()), 422, 'period_locked', 'date')
        self.assertRefused(self.api('PATCH', f'{ENTRIES}/{entry["id"]}', json={'ref': 'X'}), 422, 'period_locked', 'date')
        self.assertEqual(self.env['account.move'].browse(entry['id']).state, 'draft')

    def test_reset_to_draft_in_a_locked_period_is_422_period_locked(self):
        entry = self.create_entry()
        self.post_entry(entry['id'])
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{ENTRIES}/{entry["id"]}/reset-to-draft', json={}), 422, 'period_locked')

    def _reconciled_pair(self):
        debit = self.entry_body(lines=[
            {'account_id': self.receivable.id, 'partner_id': self.partner.id, 'name': 'Due', 'debit': 100},
            {'account_id': self.income.id, 'name': 'Due', 'credit': 100},
        ])
        credit = self.entry_body(lines=[
            {'account_id': self.receivable.id, 'partner_id': self.partner.id, 'name': 'Settle', 'credit': 100},
            {'account_id': self.expense.id, 'name': 'Settle', 'debit': 100},
        ])
        first, second = (self.post_entry(self.create_entry(body)['id']) for body in (debit, credit))
        self.env['account.move'].browse([first['id'], second['id']]).line_ids.filtered(
            lambda line: line.account_id == self.receivable,
        ).reconcile()
        return first, second

    def test_reset_of_an_entry_with_reconciled_lines_is_422_has_reconciliations(self):
        first, second = self._reconciled_pair()
        lines = self.env['account.move'].browse([first['id'], second['id']]).line_ids.filtered(
            lambda line: line.account_id == self.receivable,
        )
        result = self.api('POST', f'{ENTRIES}/{first["id"]}/reset-to-draft', json={})
        self.assertRefused(result, 422, 'has_reconciliations')
        self.assertIn('/unreconcile', result.json()['message'])
        self.assertEqual(result.json()['details']['line_ids'], lines.filtered(lambda line: line.move_id.id == first['id']).ids)
        self.assertEqual(self.env['account.move'].browse(first['id']).state, 'posted')
        self.assertEqual(lines.mapped('reconciled'), [True, True])

    def test_unreconcile_removes_the_reconciliation_then_reset_works(self):
        first, second = self._reconciled_pair()
        result = self.api('POST', f'{ENTRIES}/{first["id"]}/unreconcile', json={})
        self.assertEqual((result.status_code, result.json()['state']), (200, 'posted'), result.text)
        self.assertFalse(self.env['account.move'].browse([first['id'], second['id']]).line_ids.matched_debit_ids)
        self.assertEqual(self.api('POST', f'{ENTRIES}/{first["id"]}/reset-to-draft', json={}).json()['state'], 'draft')

    def test_unreconcile_without_reconciled_lines_is_422_invalid_state(self):
        entry = self.post_entry(self.create_entry()['id'])
        self.assertRefused(self.api('POST', f'{ENTRIES}/{entry["id"]}/unreconcile', json={}), 422, 'invalid_state')

    def test_unreconcile_in_a_locked_period_is_422_period_locked(self):
        first, _second = self._reconciled_pair()
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{ENTRIES}/{first["id"]}/unreconcile', json={}), 422, 'period_locked')

    def test_reversals_of_generated_moves_and_exchange_differences_are_not_entries(self):
        payment = self.env['account.payment'].with_company(self.company).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': self.partner.id,
            'amount': 10, 'date': '2026-10-18', 'journal_id': self.bank.id,
        })
        reversal = payment.move_id.copy({'reversed_entry_id': payment.move_id.id})
        manual = self.env['account.move'].browse(self.create_entry()['id'])
        manual_reversal = manual.copy({'reversed_entry_id': manual.id})
        first, _second = self._reconciled_pair()
        exchange = self.env['account.move'].browse(self.create_entry()['id'])
        self.env['account.move'].browse(first['id']).line_ids.matched_debit_ids.exchange_move_id = exchange
        self.env['account.move'].browse(first['id']).line_ids.matched_credit_ids.exchange_move_id = exchange
        listed = {item['id'] for item in self.api('GET', f'{ENTRIES}?limit=100').json()['items']}
        self.assertLessEqual({manual.id, manual_reversal.id}, listed)
        for generated in (reversal, exchange):
            self.assertNotIn(generated.id, listed)
            self.assertEqual(self.api('GET', f'{ENTRIES}/{generated.id}').status_code, 404)


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceEntryAccess(EntryCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.entry = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'entry', 'journal_id': cls.general.id, 'date': '2026-10-18',
            'line_ids': [
                Command.create({'account_id': cls.expense.id, 'debit': 10, 'name': 'x'}),
                Command.create({'account_id': cls.income.id, 'credit': 10, 'name': 'x'}),
            ],
        })
        cls.user_with('finance_entries_read_only', ['finance.entries.read'])
        cls.user_with('finance_entries_manager', ['finance.entries.read', 'finance.entries.manage'])
        cls.user_with('finance_entries_poster', ['finance.entries.read', 'finance.entries.manage', 'finance.entries.post'])
        cls.user_with('finance_invoices_only', ['finance.invoices.read', 'finance.invoices.manage', 'finance.invoices.post'])

    def _routes(self):
        entry = f'{ENTRIES}/{self.entry.id}'
        return {
            'read': (('GET', ENTRIES), ('GET', entry)),
            'manage': (('POST', ENTRIES), ('PATCH', entry), ('DELETE', entry)),
            'post': (
                ('POST', f'{entry}/post'), ('POST', f'{entry}/reset-to-draft'), ('POST', f'{entry}/unreconcile'),
            ),
        }

    def _statuses(self, login, group):
        self.authenticate(login, PASSWORD)
        body = self.entry_body() if group == 'manage' else {}
        return {
            (method, path): self.api(method, path, json=None if method in ('GET', 'DELETE') else body).status_code
            for method, path in self._routes()[group]
        }

    def test_403_matrix(self):
        expectations = {
            'finance_entries_read_only': {'read': False, 'manage': True, 'post': True},
            'finance_entries_manager': {'read': False, 'manage': False, 'post': True},
            'finance_invoices_only': {'read': True, 'manage': True, 'post': True},
        }
        for login, groups in expectations.items():
            for group, forbidden in groups.items():
                with self.subTest(login=login, group=group):
                    statuses = self._statuses(login, group)
                    if forbidden:
                        self.assertEqual(set(statuses.values()), {403}, statuses)
                    else:
                        self.assertNotIn(403, statuses.values(), statuses)

    def test_the_poster_may_use_every_route_and_the_outsider_none(self):
        for group in ('read', 'manage', 'post'):
            self.assertNotIn(403, self._statuses('finance_entries_poster', group).values())
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        for method, path in (route for routes in self._routes().values() for route in routes):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.api(method, path, json=None if method in ('GET', 'DELETE') else {}).status_code, 403)
