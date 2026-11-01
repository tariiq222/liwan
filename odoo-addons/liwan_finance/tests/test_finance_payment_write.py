# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PAYMENTS, LiwanFinanceWriteCase
from odoo.addons.liwan_finance.serializers.common import dump_number

PAYMENT_KEYS = {
    'id', 'name', 'payment_type', 'partner_type', 'state', 'partner', 'journal', 'date', 'memo',
    'currency', 'amount', 'unallocated', 'exchange_difference', 'invoices', 'allowed_actions', 'blocked_actions',
}


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePaymentWrite(LiwanFinanceWriteCase):

    def _pay(self, invoices, **overrides):
        return self.api('POST', PAYMENTS, json=self.pay_body(invoices, **overrides))

    def _invoice(self, invoice):
        return self.api('GET', f'{INVOICES}/{invoice["id"]}').json()

    def test_a_full_payment_of_a_1150_sar_invoice_leaves_nothing_open(self):
        invoice = self.posted_invoice()
        result = self._pay([invoice], memo='Settlement')
        self.assertEqual(result.status_code, 201, result.text)
        payment = result.json()
        self.assertEqual(set(payment), PAYMENT_KEYS)
        self.assertEqual(
            (payment['amount'], payment['currency'], payment['payment_type'], payment['partner_type'], payment['memo']),
            (1150, 'SAR', 'inbound', 'customer', 'Settlement'),
        )
        self.assertEqual((payment['journal']['id'], payment['date']), (self.bank.id, '2026-10-19'))
        self.assertEqual(payment['state'], 'paid')
        paid = self._invoice(invoice)
        self.assertEqual((paid['amount_residual'], paid['payment_state']), (0, 'paid'))
        listed = self.api('GET', PAYMENTS).json()['items']
        self.assertIn(payment['id'], {row['id'] for row in listed})

    def test_a_number_is_null_until_odoo_assigns_one(self):
        self.assertEqual([dump_number(name) for name in (False, '', '/', 'PBNK1/2026/00001')], [None, None, None, 'PBNK1/2026/00001'])

    def test_a_partial_payment_leaves_the_rest_open(self):
        invoice = self.posted_invoice()
        self.assertEqual(self._pay([invoice], amount=500).status_code, 201)
        open_invoice = self._invoice(invoice)
        self.assertEqual((open_invoice['amount_residual'], open_invoice['payment_state']), (650, 'partial'))
        self.assertEqual(self._pay([open_invoice]).status_code, 201)
        self.assertEqual(self._invoice(invoice)['payment_state'], 'paid')

    def test_paying_a_vendor_bill_is_an_outbound_supplier_payment(self):
        bill = self.posted_invoice(self.bill_body())
        payment = self._pay([bill])
        self.assertEqual(payment.status_code, 201, payment.text)
        self.assertEqual((payment.json()['payment_type'], payment.json()['partner_type']), ('outbound', 'supplier'))

    def test_several_invoices_of_one_partner_are_paid_with_one_payment(self):
        first, second = self.posted_invoice(), self.posted_invoice()
        payment = self._pay([first, second])
        self.assertEqual(payment.status_code, 201, payment.text)
        self.assertEqual(payment.json()['amount'], 2300)
        self.assertEqual({self._invoice(first)['payment_state'], self._invoice(second)['payment_state']}, {'paid'})

    def test_a_payment_method_line_of_the_journal_is_accepted(self):
        invoice = self.posted_invoice()
        line = self.bank.inbound_payment_method_line_ids[0]
        self.assertEqual(self._pay([invoice], payment_method_line_id=line.id).status_code, 201)

    def test_an_amount_above_the_open_balance_is_a_422_amount_exceeds_residual(self):
        invoice = self.posted_invoice()
        self.assertRefused(self._pay([invoice], amount=1150.01), 422, 'amount_exceeds_residual', 'amount')
        self.assertEqual(self._invoice(invoice)['amount_residual'], 1150)
        self.assertEqual(self._pay([invoice]).status_code, 201)
        self.assertRefused(self._pay([invoice], amount=1), 422, 'amount_exceeds_residual', 'amount')

    def test_only_posted_invoices_of_the_company_can_be_paid(self):
        draft = self.create_invoice()
        self.assertRefused(self._pay([draft]), 422, 'not_posted', 'invoice_ids')
        foreign = {'id': self.other_invoice.id, 'amount_residual': 1150}
        self.assertRefused(self._pay([foreign]), 422, 'invalid', 'invoice_ids')
        self.assertRefused(self._pay([{'id': 999999999, 'amount_residual': 1}]), 422, 'invalid', 'invoice_ids')

    def test_invoices_of_different_partners_cannot_share_a_payment(self):
        customer, other = self.posted_invoice(), self.posted_invoice(self.invoice_body(partner_id=self.vendor.id))
        self.assertRefused(self._pay([customer, other]), 422, 'invalid', 'invoice_ids')

    def test_bad_bodies_are_a_422_invalid_naming_the_field(self):
        invoice = self.posted_invoice()
        for overrides, field in (
            ({'amount': '1150'}, 'amount'),
            ({'amount': 0}, 'amount'),
            ({'amount': -5}, 'amount'),
            ({'amount': True}, 'amount'),
            ({'payment_date': '19/10/2026'}, 'payment_date'),
            ({'invoice_ids': []}, 'invoice_ids'),
            ({'invoice_ids': [invoice['id'], invoice['id']]}, 'invoice_ids'),
            ({'journal_id': self.other_bank.id}, 'journal_id'),
            ({'journal_id': self._journal(self.company, 'sale').id}, 'journal_id'),
            ({'payment_method_line_id': 999999999}, 'payment_method_line_id'),
            ({'status': 'paid'}, 'status'),
        ):
            with self.subTest(overrides=overrides):
                self.assertRefused(self._pay([invoice], **overrides), 422, 'invalid', field)
        body = self.pay_body([invoice])
        del body['journal_id']
        self.assertRefused(self.api('POST', PAYMENTS, json=body), 422, 'invalid', 'journal_id')
        self.assertEqual(self._invoice(invoice)['amount_residual'], 1150)

    def test_cancelling_a_payment_reopens_the_invoice_and_it_can_be_reset_to_draft(self):
        invoice = self.posted_invoice()
        payment = self._pay([invoice]).json()
        cancelled = self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={})
        self.assertEqual((cancelled.status_code, cancelled.json()['state']), (200, 'canceled'))
        self.assertEqual(self._invoice(invoice)['amount_residual'], 1150)
        self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={}), 422, 'invalid_state')
        reset = self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft', json={})
        self.assertEqual((reset.status_code, reset.json()['state']), (200, 'draft'))
        self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft', json={}), 422, 'invalid_state')

    def test_a_cancelled_payment_inside_a_closed_period_cannot_be_reset_to_draft(self):
        payment = self._pay([self.posted_invoice()]).json()
        self.api('POST', f'{PAYMENTS}/{payment["id"]}/cancel', json={})
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self.api('POST', f'{PAYMENTS}/{payment["id"]}/reset-to-draft', json={}), 422, 'period_locked')

    def test_a_foreign_or_missing_payment_is_a_404(self):
        for target in (self.other_payment.id, 999999999):
            for action in ('cancel', 'reset-to-draft'):
                with self.subTest(target=target, action=action):
                    self.assertRefused(self.api('POST', f'{PAYMENTS}/{target}/{action}', json={}), 404, 'not_found')

    def test_a_closed_period_is_a_422_period_locked_for_payments_and_invoice_changes(self):
        invoice = self.posted_invoice()
        payment = self._pay([invoice], amount=100).json()
        unpaid = self.posted_invoice()
        self.company.fiscalyear_lock_date = '2026-10-31'
        self.assertRefused(self._pay([self._invoice(invoice)], amount=50), 422, 'period_locked', 'payment_date')
        for route in (f'{PAYMENTS}/{payment["id"]}/cancel', f'{INVOICES}/{unpaid["id"]}/cancel'):
            with self.subTest(route=route):
                refused = self.api('POST', route, json={})
                self.assertRefused(refused, 422, 'period_locked')
                self.assertIn('detail', refused.json()['details'])
        self.assertEqual(self._invoice(unpaid)['state'], 'posted')
        later = self._pay([self._invoice(invoice)], amount=50, payment_date='2026-11-02')
        self.assertEqual(later.status_code, 201, later.text)

    def test_invoices_and_credit_notes_cannot_be_paid_together(self):
        invoice = self.posted_invoice()
        refund = self.posted_invoice(self.invoice_body(move_type='out_refund'))
        self.assertRefused(self._pay([invoice, refund]), 422, 'invalid', 'invoice_ids')

    def test_a_journal_in_another_currency_than_the_invoices_is_refused(self):
        usd = self.env.ref('base.USD')
        usd.active = True
        self.bank.currency_id = usd
        invoice = self.posted_invoice()
        self.assertRefused(self._pay([invoice]), 422, 'journal_currency_mismatch', 'journal_id')
        self.assertEqual(self._invoice(invoice)['amount_residual'], 1150)
