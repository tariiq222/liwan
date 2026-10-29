# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import tagged

from .oca_common import BANK, BANK_LINES, WebVueFinanceOcaCase
from .write_common import INVOICES

LOCKED_DAY = '2026-10-10'
OPEN_DAY = '2026-11-02'
LOCK = '2026-10-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceLockDates(WebVueFinanceOcaCase):
    """Odoo moves the date of a document in a closed period to the first open day instead of raising: every write
    that would land there answers 422 ``period_locked``, like journal entries and payments do."""

    def lock(self, field='fiscalyear_lock_date'):
        self.company[field] = LOCK

    def assertLocked(self, result, field):  # noqa: N802
        self.assertRefused(result, 422, 'period_locked', field)
        self.assertEqual(result.json()['message'], 'the accounting period is locked for this date')

    def statement_body(self, day, **overrides):
        return {
            'journal_id': self.bank.id, 'date': day, 'name': 'Statement', 'balance_start': 0, 'balance_end_real': 750,
            'lines': [{'date': day, 'payment_ref': 'INV/2026/00001', 'partner_id': self.partner.id, 'amount': 750}],
            **overrides,
        }

    def statement_line(self, day):
        result = self.api('POST', BANK, json=self.statement_body(day))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()['lines'][0]['id']

    def test_creating_an_invoice_in_a_locked_period_is_refused(self):
        self.lock()
        before = self.env['account.move'].search_count([])
        self.assertLocked(self.api('POST', INVOICES, json=self.invoice_body(invoice_date=LOCKED_DAY)), 'invoice_date')
        self.assertEqual(self.env['account.move'].search_count([]), before)
        created = self.api('POST', INVOICES, json=self.invoice_body(invoice_date=OPEN_DAY))
        self.assertEqual(created.status_code, 201, created.text)

    def test_the_sale_and_purchase_locks_apply_to_their_own_documents(self):
        self.lock('sale_lock_date')
        self.assertLocked(self.api('POST', INVOICES, json=self.invoice_body(invoice_date=LOCKED_DAY)), 'invoice_date')
        self.assertEqual(self.api('POST', INVOICES, json=self.bill_body(invoice_date=LOCKED_DAY)).status_code, 201)
        self.company.sale_lock_date = False
        self.lock('purchase_lock_date')
        self.assertLocked(self.api('POST', INVOICES, json=self.bill_body(invoice_date=LOCKED_DAY)), 'invoice_date')
        self.assertEqual(self.api('POST', INVOICES, json=self.invoice_body(invoice_date=LOCKED_DAY)).status_code, 201)

    def test_patching_a_draft_into_or_inside_a_locked_period_is_refused(self):
        draft = self.create_invoice(self.invoice_body(invoice_date=LOCKED_DAY))
        other = self.create_invoice(self.invoice_body(invoice_date=OPEN_DAY))
        self.lock()
        route = f'{INVOICES}/{draft["id"]}'
        self.assertLocked(self.api('PATCH', route, json={'ref': 'Changed'}), 'invoice_date')
        self.assertLocked(self.api('PATCH', f'{INVOICES}/{other["id"]}', json={'invoice_date': LOCKED_DAY}), 'invoice_date')
        self.assertEqual(self.api('GET', f'{INVOICES}/{other["id"]}').json()['invoice_date'], OPEN_DAY)
        moved = self.api('PATCH', route, json={'invoice_date': OPEN_DAY})
        self.assertEqual((moved.status_code, moved.json()['invoice_date']), (200, OPEN_DAY), moved.text)
        self.assertEqual(self.api('PATCH', f'{INVOICES}/{other["id"]}', json={'ref': 'Changed'}).status_code, 200)

    def test_posting_a_draft_in_a_locked_period_is_refused_and_it_stays_a_draft(self):
        draft = self.create_invoice(self.invoice_body(invoice_date=LOCKED_DAY))
        bill = self.create_invoice(self.bill_body(invoice_date=LOCKED_DAY))
        self.lock()
        for document in (draft, bill):
            with self.subTest(move_type=document['move_type']):
                self.assertLocked(self.api('POST', f'{INVOICES}/{document["id"]}/post', json={}), 'invoice_date')
                self.assertEqual(self.api('GET', f'{INVOICES}/{document["id"]}').json()['state'], 'draft')
        self.company.fiscalyear_lock_date = False
        self.assertEqual(self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={}).status_code, 200)

    def test_a_debit_note_dated_in_a_locked_period_is_refused(self):
        invoice = self.posted_invoice()
        self.lock()
        route = f'{INVOICES}/{invoice["id"]}/debit-note'
        before = self.env['account.move'].search_count([])
        self.assertLocked(self.api('POST', route, json={'date': '2026-10-20'}), 'date')
        self.assertEqual(self.env['account.move'].search_count([]), before)
        self.assertEqual(self.api('POST', route, json={'date': OPEN_DAY}).status_code, 201)

    def test_a_bank_statement_with_a_line_in_a_locked_period_is_refused(self):
        self.lock()
        before = self.env['account.bank.statement.line'].search_count([])
        body = self.statement_body(OPEN_DAY)
        body['lines'].append({'date': LOCKED_DAY, 'payment_ref': 'Old deposit', 'amount': 10})
        self.assertLocked(self.api('POST', BANK, json=body), 'lines[1].date')
        self.assertEqual(self.env['account.bank.statement.line'].search_count([]), before)
        self.assertEqual(self.api('POST', BANK, json=self.statement_body(OPEN_DAY)).status_code, 201)

    def test_reconciling_a_line_in_a_locked_period_is_refused(self):
        line_id = self.statement_line(LOCKED_DAY)
        receivable = self.invoice.line_ids.filtered(lambda item: item.account_id.account_type == 'asset_receivable')
        # Odoo refuses to lock a period that still has unreconciled lines; a lock set before the line was
        # imported (or by a data fix) is the case under test, so only that guard is skipped.
        with patch.object(type(self.company), '_validate_locks', lambda *args, **kwargs: None):
            self.lock()
        result = self.api('POST', f'{BANK_LINES}/{line_id}/reconcile', json={'move_line_ids': [receivable.id]})
        self.assertLocked(result, 'date')
        self.assertFalse(self.env['account.bank.statement.line'].browse(line_id).is_reconciled)
        auto = self.api('POST', f'{BANK}/{self.env["account.bank.statement.line"].browse(line_id).statement_id.id}/auto-reconcile', json={'apply': True})
        self.assertEqual(auto.status_code, 200, auto.text)
        self.assertEqual([item['reason'] for item in auto.json()['review']], ['failed'])
