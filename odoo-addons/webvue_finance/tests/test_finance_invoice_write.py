# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .write_common import INVOICES, WebVueFinanceWriteCase

DETAIL_KEYS = {
    'id', 'name', 'move_type', 'state', 'payment_state', 'partner', 'journal', 'invoice_date',
    'invoice_date_due', 'currency', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual',
    'ref', 'debit_origin', 'credit_origin', 'zatca', 'lines', 'allowed_actions', 'blocked_actions',
}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceInvoiceWrite(WebVueFinanceWriteCase):

    def _route(self, invoice, action=''):
        return f'{INVOICES}/{invoice["id"]}{action}'

    def test_creates_a_draft_1000_sar_invoice_with_15_percent_vat(self):
        body = self.create_invoice(self.invoice_body(ref='PO-77'))
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual(
            (body['state'], body['move_type'], body['currency'], body['ref']), ('draft', 'out_invoice', 'SAR', 'PO-77'),
        )
        self.assertEqual((body['amount_untaxed'], body['amount_tax'], body['amount_total']), (1000, 150, 1150))
        (line,) = body['lines']
        self.assertEqual((line['price_subtotal'], line['price_total']), (1000, 1150))
        self.assertEqual(body['partner'], {'id': self.partner.id, 'name': 'Al Noor Trading'})
        self.assertEqual(self.env['account.move'].browse(body['id']).company_id, self.company)

    def test_create_patch_post_pay_flow(self):
        draft = self.create_invoice(self.invoice_body(lines=[{
            'name': 'Consulting', 'quantity': 1, 'price_unit': 800, 'tax_ids': [self.sale_vat.id],
        }]))
        self.assertEqual(draft['amount_total'], 920)
        patched = self.api('PATCH', self._route(draft), json={
            'ref': 'INV-REF', 'invoice_date_due': '2026-11-18',
            'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 1000, 'tax_ids': [self.sale_vat.id]}],
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(
            (patched.json()['amount_total'], patched.json()['ref'], patched.json()['invoice_date_due']),
            (1150, 'INV-REF', '2026-11-18'),
        )
        self.assertEqual(len(patched.json()['lines']), 1)
        posted = self.post_invoice(draft['id'])
        self.assertEqual((posted['state'], posted['amount_residual']), ('posted', 1150))
        self.assertNotIn(posted['name'], ('', '/'))
        payment = self.api('POST', '/api/v1/finance/payments', json=self.pay_body([posted]))
        self.assertEqual(payment.status_code, 201, payment.text)
        paid = self.api('GET', self._route(draft)).json()
        self.assertEqual((paid['amount_residual'], paid['payment_state']), (0, 'paid'))

    def test_a_vendor_bill_and_a_credit_note_are_created_and_posted(self):
        bill = self.posted_invoice(self.bill_body())
        self.assertEqual((bill['move_type'], bill['amount_total'], bill['partner']['name']), ('in_invoice', 1150, 'Gulf Supplies'))
        refund = self.posted_invoice(self.invoice_body(move_type='out_refund'))
        self.assertEqual((refund['move_type'], refund['amount_total'], refund['state']), ('out_refund', 1150, 'posted'))
        vendor_refund = self.create_invoice(self.bill_body(move_type='in_refund'))
        self.assertEqual(vendor_refund['move_type'], 'in_refund')

    def test_the_journal_is_chosen_at_creation_among_the_journals_of_the_documents_kind(self):
        second = self.env['account.journal'].create({'name': 'Second sales', 'code': 'SS2', 'type': 'sale', 'company_id': self.company.id})
        invoice = self.create_invoice(self.invoice_body(journal_id=second.id))
        self.assertEqual(self.env['account.move'].browse(invoice['id']).journal_id, second)
        for journal in (self.bank, self._journal(self.other_company, 'sale'), self._journal(self.company, 'purchase')):
            with self.subTest(journal=journal.display_name):
                self.assertRefused(self.api('POST', INVOICES, json=self.invoice_body(journal_id=journal.id)), 422, 'invalid', 'journal_id')
        self.assertRefused(self.api('PATCH', self._route(invoice), json={'journal_id': second.id}), 422, 'invalid', 'journal_id')

    def test_a_patch_without_lines_keeps_them_and_a_patch_with_lines_replaces_them(self):
        draft = self.create_invoice(self.invoice_body(lines=[
            {'name': 'A', 'price_unit': 100}, {'name': 'B', 'price_unit': 200, 'discount': 50},
        ]))
        self.assertEqual(len(draft['lines']), 2)
        kept = self.api('PATCH', self._route(draft), json={'ref': 'only the reference'}).json()
        self.assertEqual({line['id'] for line in kept['lines']}, {line['id'] for line in draft['lines']})
        replaced = self.api('PATCH', self._route(draft), json={'lines': [{'name': 'C', 'price_unit': 5, 'quantity': 3}]}).json()
        self.assertEqual([(line['name'], line['price_subtotal']) for line in replaced['lines']], [('C', 15)])
        self.assertEqual(self.env['account.move.line'].search_count([('move_id', '=', draft['id']), ('name', 'in', ('A', 'B'))]), 0)

    def test_a_line_can_name_its_account_and_a_patch_changes_the_partner_and_date(self):
        account = self.env['account.account'].search([
            ('company_ids', 'in', self.company.ids), ('account_type', '=', 'income'),
        ], limit=1)
        draft = self.create_invoice(self.invoice_body(lines=[{'name': 'X', 'price_unit': 10, 'account_id': account.id}]))
        self.assertEqual(draft['lines'][0]['account']['id'], account.id)
        patched = self.api('PATCH', self._route(draft), json={'partner_id': self.vendor.id, 'invoice_date': '2026-10-20'})
        self.assertEqual((patched.json()['partner']['id'], patched.json()['invoice_date']), (self.vendor.id, '2026-10-20'))

    def test_bad_bodies_are_a_422_invalid_naming_the_field(self):
        line = {'name': 'X', 'price_unit': 10}
        for overrides, field in (
            ({'move_type': 'out_receipt'}, 'move_type'),
            ({'move_type': 'entry'}, 'move_type'),
            ({'partner_id': 'abc'}, 'partner_id'),
            ({'invoice_date': '18-10-2026'}, 'invoice_date'),
            ({'currency': 'ZZZ'}, 'currency'),
            ({'currency': 5}, 'currency'),
            ({'lines': []}, 'lines'),
            ({'lines': 'x'}, 'lines'),
            ({'lines': [{'name': 'X'}]}, 'lines[0].price_unit'),
            ({'lines': [{'price_unit': 1}]}, 'lines[0].name'),
            ({'lines': [{**line, 'price_unit': '1000'}]}, 'lines[0].price_unit'),
            ({'lines': [{**line, 'price_unit': True}]}, 'lines[0].price_unit'),
            ({'lines': [{**line, 'quantity': -1}]}, 'lines[0].quantity'),
            ({'lines': [{**line, 'price_unit': 10 ** 12}]}, 'lines[0].price_unit'),
            ({'lines': [{**line, 'price_unit': -10 ** 12}]}, 'lines[0].price_unit'),
            ({'invoice_date': '20261018'}, 'invoice_date'),
            ({'lines': [{**line, 'tax_ids': [self.purchase_vat.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'discount': 101}]}, 'lines[0].discount'),
            ({'lines': [{**line, 'tax_ids': [self.sale_vat.id, self.sale_vat.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'tax_ids': [self.other_sale_vat.id]}]}, 'lines[0].tax_ids'),
            ({'lines': [{**line, 'account_id': 999999999}]}, 'lines[0].account_id'),
            ({'lines': [{**line, 'color': 'red'}]}, 'lines[0].color'),
            ({'partner_id': self.foreign_partner.id}, 'partner_id'),
            ({'state': 'posted'}, 'state'),
        ):
            with self.subTest(overrides=overrides):
                result = self.api('POST', INVOICES, json=self.invoice_body(**overrides))
                self.assertRefused(result, 422, 'invalid', field)
        self.assertRefused(self.api('POST', INVOICES, json={}), 422, 'invalid')

    def test_a_patch_rejects_the_move_type_state_and_an_empty_body(self):
        draft = self.create_invoice()
        for body in ({'move_type': 'in_invoice'}, {'state': 'posted'}, {'amount_total': 1}):
            with self.subTest(body=body):
                self.assertRefused(self.api('PATCH', self._route(draft), json=body), 422, 'invalid', next(iter(body)))
        self.assertRefused(self.api('PATCH', self._route(draft), json={}), 422, 'invalid')

    def test_a_posted_invoice_cannot_be_patched_or_deleted_or_posted_again(self):
        posted = self.posted_invoice()
        for method, action, body in (
            ('PATCH', '', {'ref': 'late'}), ('DELETE', '', None), ('POST', '/post', {}),
        ):
            with self.subTest(method=method, action=action):
                self.assertRefused(self.api(method, self._route(posted, action), json=body), 422, 'not_draft')
        self.assertEqual(self.api('GET', self._route(posted)).json()['ref'], '')

    def test_deletes_a_draft_with_204(self):
        draft = self.create_invoice()
        result = self.api('DELETE', self._route(draft))
        self.assertEqual(result.status_code, 204, result.text)
        self.assertFalse(self.env['account.move'].browse(draft['id']).exists())

    def test_cancel_and_reset_to_draft_follow_the_state(self):
        posted = self.posted_invoice()
        cancelled = self.api('POST', self._route(posted, '/cancel'), json={})
        self.assertEqual((cancelled.status_code, cancelled.json()['state']), (200, 'cancel'))
        self.assertRefused(self.api('POST', self._route(posted, '/cancel'), json={}), 422, 'invalid_state')
        reset = self.api('POST', self._route(posted, '/reset-to-draft'), json={})
        self.assertEqual((reset.status_code, reset.json()['state']), (200, 'draft'))
        self.assertRefused(self.api('POST', self._route(posted, '/reset-to-draft'), json={}), 422, 'invalid_state')
        again = self.api('POST', self._route(posted, '/post'), json={})
        self.assertEqual(again.json()['state'], 'posted')
        direct = self.api('POST', self._route(posted, '/reset-to-draft'), json={})
        self.assertEqual(direct.json()['state'], 'draft')

    def test_a_vendor_bill_without_a_bill_date_is_refused_on_post_with_422(self):
        draft = self.create_invoice(self.bill_body(invoice_date=None))
        result = self.api('POST', self._route(draft, '/post'), json={})
        self.assertRefused(result, 422, 'invalid')
        self.assertEqual(self.api('GET', self._route(draft)).json()['state'], 'draft')

    def test_missing_and_foreign_company_invoices_are_404_on_every_write(self):
        for target in (self.other_invoice.id, 999999999):
            route = f'{INVOICES}/{target}'
            for method, path, body in (
                ('PATCH', route, {'ref': 'x'}), ('DELETE', route, None), ('POST', f'{route}/post', {}),
                ('POST', f'{route}/cancel', {}), ('POST', f'{route}/reset-to-draft', {}),
            ):
                with self.subTest(method=method, path=path):
                    self.assertRefused(self.api(method, path, json=body), 404, 'not_found')
        self.assertEqual(self.other_invoice.state, 'posted')

    def test_a_failed_write_leaves_nothing_behind(self):
        before = self.env['account.move'].search_count([])
        result = self.api('POST', INVOICES, json=self.invoice_body(lines=[
            {'name': 'ok', 'price_unit': 1}, {'name': 'bad', 'price_unit': 1, 'tax_ids': [self.other_sale_vat.id]},
        ]))
        self.assertEqual(result.status_code, 422)
        self.assertEqual(self.env['account.move'].search_count([]), before)

    def test_a_sale_tax_on_a_vendor_bill_is_refused(self):
        lines = [{'name': 'Paper', 'price_unit': 10, 'tax_ids': [self.sale_vat.id]}]
        self.assertRefused(
            self.api('POST', INVOICES, json=self.bill_body(lines=lines)), 422, 'invalid', 'lines[0].tax_ids',
        )
        bill = self.create_invoice(self.bill_body())
        self.assertRefused(
            self.api('PATCH', self._route(bill), json={'lines': lines}), 422, 'invalid', 'lines[0].tax_ids',
        )

    def test_a_zero_quantity_line_is_accepted(self):
        draft = self.create_invoice(self.invoice_body(lines=[{'name': 'Free', 'quantity': 0, 'price_unit': 10}]))
        self.assertEqual(draft['lines'][0]['quantity'], 0)

    def test_receipts_are_readable_but_have_no_write_route(self):
        receipt = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_receipt', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {'name': 'Cash sale', 'price_unit': 10})],
        })
        route = f'{INVOICES}/{receipt.id}'
        self.assertEqual(self.api('GET', route).status_code, 200)
        for method, path, body in (
            ('PATCH', route, {'ref': 'x'}), ('DELETE', route, None), ('POST', f'{route}/post', {}),
            ('POST', f'{route}/cancel', {}), ('POST', f'{route}/reset-to-draft', {}),
        ):
            with self.subTest(method=method, path=path):
                self.assertRefused(self.api(method, path, json=body), 404, 'not_found')
        self.assertEqual(receipt.state, 'draft')

    def test_cancel_and_reset_of_an_invoice_with_payments_are_refused_until_the_payment_is_cancelled(self):
        invoice = self.posted_invoice()
        payment = self.api('POST', '/api/v1/finance/payments', json=self.pay_body([invoice])).json()
        for action in ('cancel', 'reset-to-draft'):
            with self.subTest(action=action):
                refused = self.api('POST', self._route(invoice, f'/{action}'), json={})
                self.assertRefused(refused, 422, 'has_payments')
                self.assertEqual(refused.json()['details'], {'payment_ids': [payment['id']]})
        self.assertEqual(self.api('GET', self._route(invoice)).json()['payment_state'], 'paid')
        self.api('POST', f'/api/v1/finance/payments/{payment["id"]}/cancel', json={})
        cancelled = self.api('POST', self._route(invoice, '/cancel'), json={})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()['state'], 'cancel')

    def test_a_refusal_on_create_is_classified_with_the_default_journal_lock_dates(self):
        self.company.fiscalyear_lock_date = '2026-10-31'

        def refuse(records, *args, **kwargs):
            message = 'locked'
            raise UserError(message)

        with patch.object(type(self.env['account.move']), 'create', refuse):
            result = self.api('POST', INVOICES, json=self.invoice_body())
        self.assertRefused(result, 422, 'period_locked')

    def test_a_model_the_caller_cannot_read_is_a_403_not_a_422(self):
        def deny(records, *args, **kwargs):
            message = 'no access'
            raise AccessError(message)

        with patch.object(type(self.env['account.tax']), 'search', deny):
            result = self.api('POST', INVOICES, json=self.invoice_body())
        self.assertRefused(result, 403, 'forbidden')
