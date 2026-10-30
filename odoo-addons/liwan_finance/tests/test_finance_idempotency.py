# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import INVOICES, PAYMENTS, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceIdempotency(LiwanFinanceWriteCase):

    def send(self, path, body, key=None):
        headers = {'Content-Type': 'application/json', **({'Idempotency-Key': key} if key else {})}
        return self.url_open(path, json=body, headers=headers, method='POST')

    def receipt(self, **overrides):
        return {
            'payment_type': 'inbound', 'partner_id': self.partner.id, 'amount': 300, 'payment_date': '2026-10-19',
            'journal_id': self.bank.id, **overrides,
        }

    def count(self, model):
        return self.env[model].search_count([('company_id', '=', self.company.id)])

    def test_a_repeated_receipt_is_created_once_and_answered_the_same(self):
        before = self.count('account.payment')
        first = self.send(f'{PAYMENTS}/standalone', self.receipt(), 'receipt-0001')
        second = self.send(f'{PAYMENTS}/standalone', self.receipt(), 'receipt-0001')
        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.count('account.payment') - before, 1)

    def test_without_a_key_every_request_creates(self):
        before = self.count('account.payment')
        for _ in range(2):
            self.assertEqual(self.send(f'{PAYMENTS}/standalone', self.receipt()).status_code, 201)
        self.assertEqual(self.count('account.payment') - before, 2)

    def test_a_repeated_invoice_and_invoice_payment_are_created_once(self):
        before = self.count('account.move')
        first = self.send(INVOICES, self.invoice_body(), 'invoice-0001')
        second = self.send(INVOICES, self.invoice_body(), 'invoice-0001')
        self.assertEqual(first.json()['id'], second.json()['id'])
        self.assertEqual(self.count('account.move') - before, 1)
        invoice = self.post_invoice(first.json()['id'])
        paid = [self.send(PAYMENTS, self.pay_body([invoice]), 'pay-invoice-0001') for _ in range(2)]
        self.assertEqual([item.status_code for item in paid], [201, 201])
        self.assertEqual(paid[0].json()['id'], paid[1].json()['id'])
        self.assertEqual(self.env['account.payment'].search_count([('memo', 'like', invoice['name'])]), 1)

    def test_the_same_key_for_another_body_route_or_user_is_refused(self):
        self.send(f'{PAYMENTS}/standalone', self.receipt(), 'shared-key-1')
        changed = self.send(f'{PAYMENTS}/standalone', self.receipt(amount=301), 'shared-key-1')
        self.assertRefused(changed, 422, 'idempotency_key_reused')
        elsewhere = self.send(INVOICES, self.invoice_body(), 'shared-key-1')
        self.assertRefused(elsewhere, 422, 'idempotency_key_reused')

    def test_a_refused_request_leaves_no_key_so_the_corrected_one_goes_through(self):
        refused = self.send(f'{PAYMENTS}/standalone', self.receipt(amount=0), 'retry-key-01')
        self.assertRefused(refused, 422, 'invalid', 'amount')
        self.assertEqual(self.env['liwan.finance.idempotency'].search_count([('key', '=', 'retry-key-01')]), 0)
        self.assertEqual(self.send(f'{PAYMENTS}/standalone', self.receipt(), 'retry-key-01').status_code, 201)

    def test_a_malformed_key_is_refused(self):
        for key in ('short', 'has space in it', 'x' * 129, 'ünïcode-key-1'):
            with self.subTest(key=key):
                self.assertRefused(self.send(f'{PAYMENTS}/standalone', self.receipt(), key), 422, 'invalid', 'Idempotency-Key')

    def test_keys_are_per_company_and_expire(self):
        self.send(f'{PAYMENTS}/standalone', self.receipt(), 'expiring-key-1')
        row = self.env['liwan.finance.idempotency'].search([('key', '=', 'expiring-key-1')])
        self.assertEqual(row.company_id, self.company)
        self.env.cr.execute("UPDATE liwan_finance_idempotency SET create_date = now() - interval '3 days' WHERE id = %s", [row.id])
        before = self.count('account.payment')
        self.assertEqual(self.send(f'{PAYMENTS}/standalone', self.receipt(), 'expiring-key-1').status_code, 201)
        self.assertEqual(self.count('account.payment') - before, 1)
