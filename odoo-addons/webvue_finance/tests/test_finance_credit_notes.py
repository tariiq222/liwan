# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PASSWORD, WebVueFinanceWriteCase

LOCK = '2026-10-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceCreditNotes(WebVueFinanceWriteCase):

    def credit(self, invoice_id, body=None):
        return self.api('POST', f'{INVOICES}/{invoice_id}/credit-note', json={} if body is None else body)

    def residual(self, invoice_id):
        return self.api('GET', f'{INVOICES}/{invoice_id}').json()['amount_residual']

    def test_a_posted_invoice_gets_a_draft_credit_note_linked_to_it(self):
        invoice = self.posted_invoice()
        result = self.credit(invoice['id'], {'reason': 'Returned goods', 'date': '2026-10-20'})
        self.assertEqual(result.status_code, 201, result.text)
        note = result.json()
        self.assertEqual((note['state'], note['move_type'], note['invoice_date']), ('draft', 'out_refund', '2026-10-20'))
        self.assertIn('Returned goods', note['ref'])
        self.assertEqual([line['name'] for line in note['lines']], [line['name'] for line in invoice['lines']])
        self.assertEqual(note['amount_total'], invoice['amount_total'])
        self.assertEqual(note['credit_origin'], {'id': invoice['id'], 'name': invoice['name']})
        self.assertIsNone(self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['credit_origin'])
        record = self.env['account.move'].browse(note['id'])
        self.assertEqual((record.reversed_entry_id.id, record.company_id), (invoice['id'], self.company))
        self.assertIn('credit_note', self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['allowed_actions'])

    def test_posting_the_credit_note_lowers_the_invoice_residual_to_zero(self):
        invoice = self.posted_invoice()
        note = self.credit(invoice['id']).json()
        self.assertEqual(self.residual(invoice['id']), invoice['amount_total'], 'a draft does not change the balance')
        self.assertEqual(self.post_invoice(note['id'])['state'], 'posted')
        self.assertEqual(self.residual(invoice['id']), 0)
        self.assertEqual(self.api('GET', f'{INVOICES}/{invoice["id"]}').json()['payment_state'], 'reversed')

    def test_a_partial_credit_note_lowers_the_residual_by_its_amount(self):
        invoice = self.posted_invoice()
        note = self.credit(invoice['id']).json()
        line = {'name': 'Consulting', 'quantity': 1, 'price_unit': 400, 'tax_ids': [self.sale_vat.id]}
        edited = self.api('PATCH', f'{INVOICES}/{note["id"]}', json={'lines': [line]})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.post_invoice(note['id'])
        self.assertEqual(self.residual(invoice['id']), invoice['amount_total'] - 460)

    def test_a_vendor_bill_gets_a_vendor_credit_note(self):
        bill = self.posted_invoice(self.bill_body())
        note = self.credit(bill['id']).json()
        self.assertEqual((note['move_type'], note['state']), ('in_refund', 'draft'))
        self.post_invoice(note['id'])
        self.assertEqual(self.residual(bill['id']), 0)

    def test_the_credit_note_is_audited(self):
        invoice = self.posted_invoice()
        before = self.env['webvue.finance.audit.event'].search_count([('action', '=', 'invoice_credit_note_created')])
        note = self.credit(invoice['id']).json()
        events = self.env['webvue.finance.audit.event'].search([('action', '=', 'invoice_credit_note_created')])
        self.assertEqual(len(events) - before, 1)
        self.assertEqual((events[0].res_model, events[0].res_id, events[0].outcome), ('account.move', note['id'], 'draft'))
        self.assertEqual(
            events[0].fields_written, ', '.join(sorted(('move_type', 'reversed_entry_id', 'date', 'ref', 'invoice_line_ids'))),
        )

    def test_a_draft_or_cancelled_invoice_is_422_not_posted(self):
        draft = self.create_invoice()
        self.assertRefused(self.credit(draft['id']), 422, 'not_posted')
        cancelled = self.create_invoice()
        self.assertEqual(self.api('POST', f'{INVOICES}/{cancelled["id"]}/cancel', json={}).status_code, 200)
        self.assertRefused(self.credit(cancelled['id']), 422, 'not_posted')

    def test_a_credit_note_cannot_be_credited(self):
        note = self.credit(self.posted_invoice()['id']).json()
        self.post_invoice(note['id'])
        self.assertRefused(self.credit(note['id']), 422, 'invalid_state')
        refund = self.posted_invoice(self.invoice_body(move_type='out_refund'))
        self.assertRefused(self.credit(refund['id']), 422, 'invalid_state')

    def test_a_credit_note_dated_in_a_locked_period_is_refused(self):
        invoice = self.posted_invoice()
        self.company.fiscalyear_lock_date = LOCK
        before = self.env['account.move'].search_count([])
        self.assertRefused(self.credit(invoice['id'], {'date': '2026-10-20'}), 422, 'period_locked', 'date')
        self.assertEqual(self.env['account.move'].search_count([]), before)
        self.assertEqual(self.credit(invoice['id'], {'date': '2026-11-02'}).status_code, 201)

    def test_the_body_is_strict(self):
        invoice = self.posted_invoice()
        for body, field in (
            ({'copy_lines': True}, 'copy_lines'),
            ({'journal_id': 1}, 'journal_id'),
            ({'date': '20/10/2026'}, 'date'),
            ({'reason': 5}, 'reason'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.credit(invoice['id'], body), 422, 'invalid', field)

    def test_another_company_invoice_and_a_missing_one_are_404(self):
        self.assertEqual(self.credit(self.other_invoice.id).status_code, 404)
        self.assertEqual(self.credit(0).status_code, 404)

    def test_it_needs_invoices_manage(self):
        invoice = self.posted_invoice()
        self.user_with('finance_credit_reader', ['finance.invoices.read'])
        self.user_with('finance_credit_manager', ['finance.invoices.read', 'finance.invoices.manage'])
        self.authenticate('finance_credit_reader', PASSWORD)
        self.assertRefused(self.credit(invoice['id']), 403, 'forbidden')
        self.authenticate('finance_credit_manager', PASSWORD)
        self.assertEqual(self.credit(invoice['id']).status_code, 201)
