# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PASSWORD, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceDebitNotes(LiwanFinanceWriteCase):

    def debit(self, invoice_id, body=None):
        return self.api('POST', f'{INVOICES}/{invoice_id}/debit-note', json={} if body is None else body)

    def test_a_posted_invoice_gets_a_draft_debit_note_linked_to_it(self):
        invoice = self.posted_invoice()
        result = self.debit(invoice['id'], {'reason': 'Late fee', 'date': '2026-10-20'})
        self.assertEqual(result.status_code, 201, result.text)
        note = result.json()
        self.assertEqual((note['state'], note['move_type'], note['invoice_date']), ('draft', 'out_invoice', '2026-10-20'))
        self.assertIn('Late fee', note['ref'])
        self.assertEqual(note['lines'], [], 'lines are not copied unless asked')
        record = self.env['account.move'].browse(note['id'])
        self.assertEqual(note['debit_origin'], {'id': invoice['id'], 'name': invoice['name']})
        self.assertIsNone(self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['debit_origin'])
        self.assertEqual(record.debit_origin_id.id, invoice['id'])
        self.assertEqual(record.company_id, self.company)

    def test_copy_lines_copies_the_invoice_lines(self):
        invoice = self.posted_invoice()
        note = self.debit(invoice['id'], {'copy_lines': True}).json()
        self.assertEqual([line['name'] for line in note['lines']], [line['name'] for line in invoice['lines']])
        self.assertEqual(note['amount_total'], invoice['amount_total'])

    def test_a_vendor_bill_gets_a_vendor_debit_note(self):
        bill = self.posted_invoice(self.bill_body())
        note = self.debit(bill['id'], {'copy_lines': True}).json()
        self.assertEqual((note['move_type'], note['state']), ('in_invoice', 'draft'))

    def test_the_debit_note_can_be_posted_through_the_invoice_route(self):
        note = self.debit(self.posted_invoice()['id'], {'copy_lines': True}).json()
        self.assertEqual(self.post_invoice(note['id'])['state'], 'posted')

    def test_a_draft_invoice_is_422_not_posted(self):
        draft = self.create_invoice()
        self.assertRefused(self.debit(draft['id']), 422, 'not_posted')

    def test_a_credit_note_or_a_debit_note_cannot_be_debited(self):
        refund = self.posted_invoice(self.invoice_body(move_type='out_refund'))
        self.assertRefused(self.debit(refund['id']), 422, 'invalid_state')
        note = self.debit(self.posted_invoice()['id'], {'copy_lines': True}).json()
        self.post_invoice(note['id'])
        self.assertRefused(self.debit(note['id']), 422, 'invalid_state')

    def test_the_body_is_strict(self):
        invoice = self.posted_invoice()
        for body, field in (
            ({'journal_id': 1}, 'journal_id'),
            ({'copy_lines': 'yes'}, 'copy_lines'),
            ({'date': '20/10/2026'}, 'date'),
            ({'reason': 5}, 'reason'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.debit(invoice['id'], body), 422, 'invalid', field)

    def test_another_company_invoice_and_a_receipt_are_404(self):
        self.assertEqual(self.debit(self.other_invoice.id).status_code, 404)
        self.assertEqual(self.debit(0).status_code, 404)

    def test_it_needs_invoices_manage(self):
        invoice = self.posted_invoice()
        self.user_with('finance_debit_reader', ['finance.invoices.read'])
        self.user_with('finance_debit_manager', ['finance.invoices.read', 'finance.invoices.manage'])
        self.authenticate('finance_debit_reader', PASSWORD)
        self.assertRefused(self.debit(invoice['id']), 403, 'forbidden')
        self.authenticate('finance_debit_manager', PASSWORD)
        self.assertEqual(self.debit(invoice['id']).status_code, 201)
