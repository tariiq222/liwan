# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PASSWORD, PAYMENTS, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceStandalonePayments(LiwanFinanceWriteCase):

    def receipt(self, amount=2000, **overrides):
        body = {
            'payment_type': 'inbound', 'partner_id': self.partner.id, 'amount': amount,
            'payment_date': '2026-10-19', 'journal_id': self.bank.id, 'memo': 'Advance', **overrides,
        }
        result = self.api('POST', f'{PAYMENTS}/standalone', json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def fetch_invoice(self, invoice):
        return self.api('GET', f'{INVOICES}/{invoice["id"]}').json()

    def test_a_receipt_without_invoices_is_posted_and_fully_unallocated(self):
        payment = self.receipt()
        self.assertIn(payment['state'], ('in_process', 'paid'))
        self.assertEqual((payment['payment_type'], payment['partner_type'], payment['amount'], payment['unallocated']), ('inbound', 'customer', 2000, 2000))
        self.assertEqual(payment['invoices'], [])
        record = self.env['account.payment'].browse(payment['id'])
        self.assertTrue(record.move_id.state == 'posted')

    def test_a_vendor_payment_without_bills(self):
        payment = self.receipt(payment_type='outbound', partner_id=self.vendor.id, amount=300)
        self.assertEqual((payment['payment_type'], payment['partner_type'], payment['unallocated']), ('outbound', 'supplier', 300))

    def test_an_advance_covers_an_invoice_and_keeps_the_rest_open(self):
        invoice = self.posted_invoice()
        payment = self.receipt(2000)
        allocated = self.api('POST', f'{PAYMENTS}/{payment["id"]}/allocate', json={'invoice_ids': [invoice['id']]})
        self.assertEqual(allocated.status_code, 200, allocated.text)
        self.assertEqual((allocated.json()['unallocated'], [item['id'] for item in allocated.json()['invoices']]), (850, [invoice['id']]))
        settled = self.fetch_invoice(invoice)
        self.assertEqual((settled['amount_residual'], settled['payment_state']), (0, 'paid'))

    def test_a_small_advance_pays_part_of_an_invoice(self):
        invoice = self.posted_invoice()
        payment = self.receipt(500)
        allocated = self.api('POST', f'{PAYMENTS}/{payment["id"]}/allocate', json={'invoice_ids': [invoice['id']]}).json()
        self.assertEqual(allocated['unallocated'], 0)
        partial = self.fetch_invoice(invoice)
        self.assertEqual((partial['amount_residual'], partial['payment_state']), (650, 'partial'))

    def test_unallocate_reopens_the_invoice_and_the_advance(self):
        invoice = self.posted_invoice()
        payment = self.receipt(500)
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/allocate', json={'invoice_ids': [invoice['id']]})
        undone = self.api('POST', f'{PAYMENTS}/{payment["id"]}/unallocate')
        self.assertEqual(undone.status_code, 200, undone.text)
        self.assertEqual((undone.json()['unallocated'], undone.json()['invoices']), (500, []))
        self.assertEqual(self.fetch_invoice(invoice)['amount_residual'], 1150)
        self.assertEqual(self.api('POST', f'{PAYMENTS}/{payment["id"]}/unallocate').status_code, 422)

    def test_the_unallocated_balance_is_refunded_by_an_outbound_payment(self):
        advance = self.receipt(1000)
        refund = self.receipt(payment_type='outbound', partner_type='customer', amount=1000, memo='Refund of advance')
        self.assertEqual(refund['partner_type'], 'customer')
        settled = self.api('POST', f'{PAYMENTS}/{advance["id"]}/allocate', json={'payment_ids': [refund['id']]})
        self.assertEqual(settled.status_code, 200, settled.text)
        self.assertEqual(settled.json()['unallocated'], 0)
        self.assertEqual(self.api('GET', f'{PAYMENTS}?q=Refund').json()['items'][0]['unallocated'], 0)

    def test_allocation_refusals(self):
        invoice = self.posted_invoice()
        payment = self.receipt(500)
        route = f'{PAYMENTS}/{payment["id"]}/allocate'
        for body, field in (
            ({}, 'invoice_ids'),
            ({'invoice_ids': [invoice['id']], 'payment_ids': [payment['id']]}, 'invoice_ids'),
            ({'payment_ids': [payment['id']]}, 'payment_ids'),
            ({'invoice_ids': [999999]}, 'invoice_ids'),
            ({'invoice_ids': [self.other_invoice.id]}, 'invoice_ids'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', route, json=body), 422, 'invalid', field)
        bill = self.posted_invoice(self.bill_body())
        self.assertRefused(self.api('POST', route, json={'invoice_ids': [bill['id']]}), 422, 'invalid', 'invoice_ids')
        self.api('POST', route, json={'invoice_ids': [invoice['id']]})
        self.assertRefused(self.api('POST', route, json={'invoice_ids': [invoice['id']]}), 422, 'nothing_to_allocate')

    def test_standalone_refusals(self):
        base = {'payment_type': 'inbound', 'partner_id': self.partner.id, 'amount': 10, 'payment_date': '2026-10-19', 'journal_id': self.bank.id}
        for change, field in (
            ({'payment_type': 'sideways'}, 'payment_type'),
            ({'amount': 0}, 'amount'),
            ({'amount': '10'}, 'amount'),
            ({'payment_date': '19/10/2026'}, 'payment_date'),
            ({'partner_id': 999999}, 'partner_id'),
            ({'partner_id': self.env.user.partner_id.id}, 'partner_id'),
            ({'journal_id': self._journal(self.company, 'sale').id}, 'journal_id'),
            ({'journal_id': self.other_bank.id}, 'journal_id'),
            ({'invoice_ids': [1]}, 'invoice_ids'),
        ):
            with self.subTest(change=change):
                self.assertRefused(self.api('POST', f'{PAYMENTS}/standalone', json={**base, **change}), 422, 'invalid', field)
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{PAYMENTS}/standalone', json=base), 422, 'period_locked', 'payment_date')

    def test_a_payment_reset_to_draft_can_be_corrected_and_posted_again(self):
        payment = self.receipt(400)
        self.assertEqual(self.api('POST', f'{PAYMENTS}/{payment["id"]}/post').status_code, 422)
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel')
        draft = self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft').json()
        self.assertEqual((draft['state'], draft['unallocated']), ('draft', 0))
        edited = self.api('PATCH', f'{PAYMENTS}/{payment["id"]}', json={'amount': 450, 'memo': 'Corrected'})
        self.assertEqual((edited.status_code, edited.json()['amount'], edited.json()['memo']), (200, 450, 'Corrected'))
        posted = self.api('POST', f'{PAYMENTS}/{payment["id"]}/post')
        self.assertEqual(posted.status_code, 200, posted.text)
        self.assertEqual((posted.json()['unallocated'], posted.json()['amount']), (450, 450))
        self.assertRefused(self.api('PATCH', f'{PAYMENTS}/{payment["id"]}', json={'amount': 1}), 422, 'not_draft')

    def test_an_invoice_payment_reset_to_draft_is_posted_again_and_allocated_by_the_user(self):
        """Odoo forgets the invoice of a payment reset to draft: posting it again leaves its amount unallocated."""
        invoice = self.posted_invoice()
        payment = self.api('POST', PAYMENTS, json=self.pay_body([invoice])).json()
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel')
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft')
        self.assertEqual(self.fetch_invoice(invoice)['amount_residual'], 1150)
        posted = self.api('POST', f'{PAYMENTS}/{payment["id"]}/post').json()
        self.assertEqual((posted['unallocated'], posted['invoices']), (1150, []))
        self.assertEqual(self.fetch_invoice(invoice)['amount_residual'], 1150)
        allocated = self.api('POST', f'{PAYMENTS}/{payment["id"]}/allocate', json={'invoice_ids': [invoice['id']]})
        self.assertEqual((allocated.status_code, allocated.json()['unallocated']), (200, 0))
        self.assertEqual(self.fetch_invoice(invoice)['amount_residual'], 0)

    def test_a_locked_period_blocks_posting_and_allocation_changes(self):
        payment = self.receipt(400)
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel')
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft')
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/post'), 422, 'period_locked', 'date')
        self.assertRefused(self.api('PATCH', f'{PAYMENTS}/{payment["id"]}', json={'payment_date': '2026-10-20'}), 422, 'period_locked', 'payment_date')

    def test_other_company_payments_are_not_found(self):
        for route in ('allocate', 'unallocate', 'post'):
            with self.subTest(route=route):
                self.assertRefused(self.api('POST', f'{PAYMENTS}/{self.other_payment.id}/{route}', json={'invoice_ids': [1]}), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{PAYMENTS}/{self.other_payment.id}', json={'amount': 1}), 404, 'not_found')

    def test_audit_and_capability(self):
        payment = self.receipt(100)
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel')
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft')
        self.api('PATCH', f'{PAYMENTS}/{payment["id"]}', json={'amount': 120})
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/post')
        actions = self.env['liwan.finance.audit.event'].search([('res_model', '=', 'account.payment'), ('res_id', '=', payment['id'])]).mapped('action')
        self.assertEqual(set(actions), {'payment_created', 'payment_changed', 'payment_posted'})
        self.user_with('payments_reader', ['finance.payments.read'])
        self.authenticate('payments_reader', PASSWORD)
        body = {'payment_type': 'inbound', 'partner_id': self.partner.id, 'amount': 10, 'payment_date': '2026-10-19', 'journal_id': self.bank.id}
        self.assertRefused(self.api('POST', f'{PAYMENTS}/standalone', json=body), 403, 'forbidden')
        for route in ('allocate', 'unallocate', 'post'):
            self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/{route}', json={'invoice_ids': [1]}), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', f'{PAYMENTS}/{payment["id"]}', json={'amount': 1}), 403, 'forbidden')
