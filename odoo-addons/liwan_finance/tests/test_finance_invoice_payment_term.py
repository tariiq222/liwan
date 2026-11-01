# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .write_common import INVOICES, LiwanFinanceWriteCase


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceInvoicePaymentTerm(LiwanFinanceWriteCase):
    """A payment term chosen on a document derives its due date (issue #149)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        terms = cls.env['account.payment.term']
        cls.net30 = terms.create({
            'name': 'Net 30', 'company_id': cls.company.id,
            'line_ids': [Command.create({'value': 'percent', 'value_amount': 100, 'nb_days': 30})],
        })
        cls.shared = terms.create({
            'name': 'Shared net 15', 'company_id': False,
            'line_ids': [Command.create({'value': 'percent', 'value_amount': 100, 'nb_days': 15})],
        })
        cls.foreign = terms.create({
            'name': 'Foreign net 60', 'company_id': cls.other_company.id,
            'line_ids': [Command.create({'value': 'percent', 'value_amount': 100, 'nb_days': 60})],
        })

    def test_a_customer_invoice_takes_its_due_date_from_the_term(self):
        body = self.create_invoice(self.invoice_body(payment_term_id=self.net30.id))
        self.assertEqual(body['payment_term'], {'id': self.net30.id, 'name': 'Net 30'})
        self.assertEqual(body['invoice_date'], '2026-10-18')
        self.assertEqual(body['invoice_date_due'], '2026-11-17')

    def test_a_vendor_bill_takes_its_due_date_from_a_shared_term(self):
        body = self.create_invoice(self.bill_body(payment_term_id=self.shared.id))
        self.assertEqual((body['payment_term']['id'], body['invoice_date_due']), (self.shared.id, '2026-11-02'))

    def test_a_patch_sets_changes_and_clears_the_term(self):
        invoice = self.create_invoice(self.invoice_body(invoice_date_due='2026-10-18'))
        self.assertIsNone(invoice['payment_term'])
        path = f'{INVOICES}/{invoice["id"]}'
        changed = self.api('PATCH', path, json={'payment_term_id': self.net30.id}).json()
        self.assertEqual((changed['payment_term']['id'], changed['invoice_date_due']), (self.net30.id, '2026-11-17'))
        cleared = self.api('PATCH', path, json={'payment_term_id': None}).json()
        self.assertIsNone(cleared['payment_term'])

    def test_a_term_of_another_company_is_refused(self):
        result = self.api('POST', INVOICES, json=self.invoice_body(payment_term_id=self.foreign.id))
        self.assertRefused(result, 422, 'invalid', 'payment_term_id')
        self.assertRefused(self.api('POST', INVOICES, json=self.invoice_body(payment_term_id='x')), 422, 'invalid', 'payment_term_id')

    def test_the_list_carries_the_term(self):
        self.create_invoice(self.invoice_body(payment_term_id=self.net30.id))
        items = self.api('GET', INVOICES).json()['items']
        self.assertIn(self.net30.id, [(item['payment_term'] or {}).get('id') for item in items])
