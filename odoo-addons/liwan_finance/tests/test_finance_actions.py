# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import tagged

from .common import MANAGER_LOGIN
from .oca_common import ASSETS, LiwanFinanceOcaCase
from .write_common import INVOICES, PAYMENTS
from odoo.addons.liwan_api.tests.common import set_probe_feature

ENTRIES = '/api/v1/finance/entries'
BUDGETS = '/api/v1/finance/budgets'
LOCKED = '2026-10-31'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceActions(LiwanFinanceOcaCase):
    """Every finance record says what the caller may do with it now and why not, and its routes agree."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.profile = cls.asset_profile(cls.company)
        accounts = cls.env['account.account'].with_company(cls.company)

        def of_type(account_type):
            return accounts.search([('company_ids', 'in', cls.company.id), ('account_type', '=', account_type)], limit=1)

        cls.receivable, cls.expense, cls.income = of_type('asset_receivable'), of_type('expense'), of_type('income')
        cls.general = cls._journal(cls.company, 'general')

    # --- helpers ---------------------------------------------------------------------------------------

    def actions(self, body):
        """``(allowed, {action: reason})`` of a record as the API shows it."""
        return set(body['allowed_actions']), {item['action']: item['reason'] for item in body['blocked_actions']}

    def read(self, path):
        result = self.api('GET', path)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def make_invoice(self, state='draft'):
        invoice = self.create_invoice()
        return self.post_invoice(invoice['id']) if state == 'posted' else invoice

    def entry_body(self, lines=None):
        return {
            'journal_id': self.general.id, 'date': '2026-10-18', 'ref': 'ADJ',
            'lines': lines or [
                {'account_id': self.expense.id, 'name': 'Rent', 'debit': 500},
                {'account_id': self.income.id, 'name': 'Rent', 'credit': 500},
            ],
        }

    def make_entry(self, state='draft', lines=None):
        result = self.api('POST', ENTRIES, json=self.entry_body(lines))
        self.assertEqual(result.status_code, 201, result.text)
        entry = result.json()
        if state == 'posted':
            entry = self.api('POST', f'{ENTRIES}/{entry["id"]}/post', json={}).json()
        return entry

    def make_asset(self, state='draft'):
        result = self.api('POST', ASSETS, json={'profile_id': self.profile.id, 'name': 'Table', 'purchase_value': 1200, 'date_start': '2026-01-01'})
        self.assertEqual(result.status_code, 201, result.text)
        asset = result.json()
        if state != 'draft':
            asset = self.api('POST', f'{ASSETS}/{asset["id"]}/validate', json={}).json()
        return asset

    def make_budget(self, state='draft'):
        result = self.api('POST', BUDGETS, json={'name': 'Budget', 'date_from': '2026-01-01', 'date_to': '2026-12-31'})
        self.assertEqual(result.status_code, 201, result.text)
        budget = result.json()
        if state != 'draft':
            budget = self.api('POST', f'{BUDGETS}/{budget["id"]}/confirm', json={}).json()
        return budget

    def expired(self):
        """The tenant as it is once its validity ended (reads stay open, every write is refused), for any commercial mode."""
        return patch.object(type(self.env['liwan.entitlement.service']), '_liwan_effective_state', return_value='expired')

    # --- invoices --------------------------------------------------------------------------------------

    def test_a_draft_invoice_offers_edit_delete_post_and_cancel(self):
        allowed, blocked = self.actions(self.make_invoice())
        self.assertEqual((allowed, blocked), ({'edit', 'delete', 'post', 'cancel'}, {}))

    def test_a_posted_unpaid_invoice_offers_the_transitions_and_the_follow_ups(self):
        allowed, blocked = self.actions(self.make_invoice('posted'))
        self.assertEqual(allowed, {'reset_to_draft', 'cancel', 'pdf', 'debit_note', 'credit_note', 'register_payment'})
        self.assertLessEqual(set(blocked), {'zatca_submit', 'zatca_retry'})

    def test_payments_block_cancel_and_reset_exactly_as_the_routes_refuse_them(self):
        invoice = self.make_invoice('posted')
        self.assertEqual(self.api('POST', PAYMENTS, json=self.pay_body([invoice])).status_code, 201)
        detail = self.read(f'{INVOICES}/{invoice["id"]}')
        allowed, blocked = self.actions(detail)
        self.assertFalse({'cancel', 'reset_to_draft'} & allowed)
        self.assertEqual({key: blocked[key] for key in ('cancel', 'reset_to_draft')}, {'cancel': 'has_payments', 'reset_to_draft': 'has_payments'})
        self.assertNotIn('register_payment', allowed)
        for route in ('cancel', 'reset-to-draft'):
            self.assertRefused(self.api('POST', f'{INVOICES}/{invoice["id"]}/{route}', json={}), 422, 'has_payments')

    def test_a_cancelled_payment_frees_the_invoice_again(self):
        invoice = self.make_invoice('posted')
        payment = self.api('POST', PAYMENTS, json=self.pay_body([invoice])).json()
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={})
        allowed, blocked = self.actions(self.read(f'{INVOICES}/{invoice["id"]}'))
        self.assertLessEqual({'cancel', 'reset_to_draft'}, allowed)
        self.assertNotIn('cancel', blocked)

    def test_a_closed_period_blocks_what_the_server_refuses_as_period_locked(self):
        draft, posted = self.make_invoice(), self.make_invoice('posted')
        self.company.fiscalyear_lock_date = LOCKED
        allowed, blocked = self.actions(self.read(f'{INVOICES}/{draft["id"]}'))
        self.assertEqual((allowed, blocked), ({'edit', 'delete', 'cancel'}, {'post': 'period_locked'}))
        allowed, blocked = self.actions(self.read(f'{INVOICES}/{posted["id"]}'))
        self.assertEqual({key: blocked[key] for key in ('cancel', 'reset_to_draft')}, {'cancel': 'period_locked', 'reset_to_draft': 'period_locked'})
        self.assertRefused(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}), 422, 'period_locked')
        self.assertRefused(self.api('POST', f'{INVOICES}/{posted["id"]}/cancel', json={}), 422, 'period_locked')

    def test_a_reader_is_offered_only_the_print(self):
        posted = self.make_invoice('posted')
        self.user_with('invoice_reader', ['finance.invoices.read'])
        self.authenticate('invoice_reader', 'finance_write_pass_123')
        self.assertEqual(self.actions(self.read(f'{INVOICES}/{posted["id"]}')), ({'pdf'}, {}))

    def test_a_manager_who_cannot_post_is_not_offered_post_or_cancel(self):
        draft = self.make_invoice()
        self.user_with('invoice_manager', ['finance.invoices.manage', 'finance.invoices.read'])
        self.authenticate('invoice_manager', 'finance_write_pass_123')
        self.assertEqual(self.actions(self.read(f'{INVOICES}/{draft["id"]}')), ({'edit', 'delete'}, {}))

    # --- entries ---------------------------------------------------------------------------------------

    def test_an_entry_offers_what_its_state_allows(self):
        self.assertEqual(self.actions(self.make_entry()), ({'edit', 'delete', 'post'}, {}))
        self.assertEqual(self.actions(self.make_entry('posted')), ({'reset_to_draft'}, {}))

    def test_a_posted_entry_in_a_closed_period_blocks_post_and_reset(self):
        draft, posted = self.make_entry(), self.make_entry('posted')
        self.company.fiscalyear_lock_date = LOCKED
        self.assertEqual(self.actions(self.read(f'{ENTRIES}/{draft["id"]}')), ({'edit', 'delete'}, {'post': 'period_locked'}))
        self.assertEqual(self.actions(self.read(f'{ENTRIES}/{posted["id"]}')), (set(), {'reset_to_draft': 'period_locked'}))
        self.assertRefused(self.api('POST', f'{ENTRIES}/{posted["id"]}/reset-to-draft', json={}), 422, 'period_locked')

    def test_reconciled_lines_block_reset_and_offer_unreconcile(self):
        debit = self.make_entry('posted', [
            {'account_id': self.receivable.id, 'partner_id': self.partner.id, 'name': 'Due', 'debit': 100},
            {'account_id': self.income.id, 'name': 'Due', 'credit': 100},
        ])
        credit = self.make_entry('posted', [
            {'account_id': self.receivable.id, 'partner_id': self.partner.id, 'name': 'Settle', 'credit': 100},
            {'account_id': self.expense.id, 'name': 'Settle', 'debit': 100},
        ])
        moves = self.env['account.move'].browse([debit['id'], credit['id']])
        moves.line_ids.filtered(lambda line: line.account_id == self.receivable).reconcile()
        allowed, blocked = self.actions(self.read(f'{ENTRIES}/{debit["id"]}'))
        self.assertEqual((allowed, blocked), ({'unreconcile'}, {'reset_to_draft': 'has_reconciliations'}))
        self.assertRefused(self.api('POST', f'{ENTRIES}/{debit["id"]}/reset-to-draft', json={}), 422, 'has_reconciliations')
        self.company.fiscalyear_lock_date = LOCKED
        self.assertEqual(self.actions(self.read(f'{ENTRIES}/{debit["id"]}'))[1], {'reset_to_draft': 'has_reconciliations', 'unreconcile': 'period_locked'})

    def test_a_posted_entry_without_reconciled_lines_is_not_offered_unreconcile(self):
        self.assertNotIn('unreconcile', self.actions(self.make_entry('posted'))[0])
        posted = self.make_entry('posted')
        self.assertRefused(self.api('POST', f'{ENTRIES}/{posted["id"]}/unreconcile', json={}), 422, 'invalid_state')

    # --- payments --------------------------------------------------------------------------------------

    def test_a_payment_carries_its_actions_in_the_list_and_the_record(self):
        invoice = self.make_invoice('posted')
        payment = self.api('POST', PAYMENTS, json=self.pay_body([invoice])).json()
        self.assertEqual(self.actions(payment), ({'cancel', 'unallocate'}, {}))
        listed = next(item for item in self.read(PAYMENTS)['items'] if item['id'] == payment['id'])
        self.assertEqual(self.actions(listed), ({'cancel', 'unallocate'}, {}))
        cancelled = self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={}).json()
        self.assertEqual(self.actions(cancelled), ({'reset_to_draft'}, {}))
        draft = self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft', json={}).json()
        self.assertEqual(self.actions(draft), ({'cancel', 'post', 'edit'}, {}))

    def test_a_closed_period_blocks_posting_and_cancelling_a_payment(self):
        invoice = self.make_invoice('posted')
        payment = self.api('POST', PAYMENTS, json=self.pay_body([invoice])).json()
        self.company.fiscalyear_lock_date = LOCKED
        listed = next(item for item in self.read(PAYMENTS)['items'] if item['id'] == payment['id'])
        self.assertEqual(self.actions(listed)[1], {'cancel': 'period_locked'})
        self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={}), 422, 'period_locked')

    # --- budgets and assets ----------------------------------------------------------------------------

    def test_a_budget_offers_what_its_state_allows(self):
        self.assertEqual(self.actions(self.make_budget()), ({'confirm', 'cancel', 'edit_lines'}, {}))
        self.assertEqual(self.actions(self.make_budget('confirmed')), ({'reset_to_draft', 'cancel'}, {}))
        cancelled = self.api('POST', f'{BUDGETS}/{self.make_budget()["id"]}/cancel', json={}).json()
        self.assertEqual(self.actions(cancelled), ({'reset_to_draft'}, {}))

    def test_an_asset_offers_what_its_state_allows(self):
        self.assertEqual(self.actions(self.make_asset()), ({'validate', 'edit', 'delete'}, {}))
        self.assertEqual(self.actions(self.make_asset('open')), ({'dispose'}, {}))

    def test_a_reader_is_offered_no_budget_or_asset_action(self):
        budget, asset = self.make_budget(), self.make_asset()
        self.user_with('plain_reader', ['finance.budgets.read', 'finance.assets.read'])
        self.authenticate('plain_reader', 'finance_write_pass_123')
        self.assertEqual(self.actions(self.read(f'{BUDGETS}/{budget["id"]}')), (set(), {}))
        self.assertEqual(self.actions(self.read(f'{ASSETS}/{asset["id"]}')), (set(), {}))

    # --- the tenant ------------------------------------------------------------------------------------

    def served(self, method, model, record_id):
        """What the service says to the manager about a record, without a detail request (so no response is recorded for it)."""
        manager = self.env['res.users'].search([('login', '=', MANAGER_LOGIN)])
        service = self.env(user=manager.id)['liwan.finance.actions'].with_company(self.company)
        record = self.env[model].with_user(manager).with_company(self.company).browse(record_id)
        return self.actions(getattr(service, method)(record))

    def test_an_expired_tenant_blocks_every_write_but_keeps_the_print(self):
        draft, posted = self.make_invoice(), self.make_invoice('posted')
        entry, asset, budget = self.make_entry(), self.make_asset(), self.make_budget()
        with self.expired():
            allowed, blocked = self.served('_liwan_invoice_actions', 'account.move', draft['id'])
            self.assertEqual((allowed, set(blocked)), (set(), {'edit', 'delete', 'post', 'cancel'}))
            self.assertEqual(set(blocked.values()), {'tenant_read_only'})
            allowed, blocked = self.served('_liwan_invoice_actions', 'account.move', posted['id'])
            self.assertEqual(allowed, {'pdf'})
            self.assertEqual({'tenant_read_only'}, set(blocked.values()))
            self.assertLessEqual({'cancel', 'reset_to_draft', 'debit_note', 'credit_note', 'register_payment'}, set(blocked))
            for method, model, record in (
                ('_liwan_entry_actions', 'account.move', entry), ('_liwan_asset_actions', 'account.asset', asset),
                ('_liwan_budget_actions', 'mis.budget.by.account', budget),
            ):
                with self.subTest(method=method):
                    allowed, blocked = self.served(method, model, record['id'])
                    self.assertEqual((allowed, set(blocked.values())), (set(), {'tenant_read_only'}))
                    self.assertTrue(blocked)
            self.assertRefused(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}), 403, 'tenant_read_only')

    def test_a_finance_feature_kept_only_for_reading_blocks_every_write(self):
        draft = self.make_invoice()
        set_probe_feature(self, 'finance.enabled', enabled=False, retained=True)
        allowed, blocked = self.served('_liwan_invoice_actions', 'account.move', draft['id'])
        self.assertEqual((allowed, set(blocked.values())), (set(), {'feature_not_included'}))
        self.assertEqual(set(blocked), {'edit', 'delete', 'post', 'cancel'})
        self.assertRefused(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}), 403, 'feature_not_included')
