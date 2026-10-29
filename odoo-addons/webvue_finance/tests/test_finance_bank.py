# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .oca_common import BANK, BANK_LINES, WebVueFinanceOcaCase
from .write_common import PASSWORD


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceBank(WebVueFinanceOcaCase):
    """Bank statements and reconciliation over stock statements and OCA account_reconcile_oca."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.other_statement = cls.env['account.bank.statement'].with_company(cls.other_company).create({
            'date': '2026-10-31',
            'line_ids': [Command.create({
                'journal_id': cls.other_bank.id, 'date': '2026-10-31', 'payment_ref': 'Foreign line', 'amount': 10,
            })],
        })

    def statement_body(self, **overrides):
        return {
            'journal_id': self.bank.id, 'date': '2026-10-31', 'name': 'October', 'balance_start': 0, 'balance_end_real': 540,
            'lines': [
                {'date': '2026-10-25', 'payment_ref': 'INV/2026/00001', 'partner_id': self.partner.id, 'amount': 750},
                {'date': '2026-10-26', 'payment_ref': 'Gulf Supplies bill', 'partner_id': self.vendor.id, 'amount': -460},
                {'date': '2026-10-27', 'payment_ref': 'Bank interest', 'amount': 50},
                {'date': '2026-10-28', 'payment_ref': 'Unknown deposit', 'amount': 200},
            ],
            **overrides,
        }

    def statement(self, **overrides):
        result = self.api('POST', BANK, json=self.statement_body(**overrides))
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        return body, {line['payment_ref']: line['id'] for line in body['lines']}

    def receivable(self, invoice):
        return invoice.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')

    def reconcile(self, line_id, **body):
        return self.api('POST', f'{BANK_LINES}/{line_id}/reconcile', json=body)

    # --- statements ------------------------------------------------------------------------------------

    def test_a_statement_is_created_with_its_lines(self):
        body, lines = self.statement()
        self.assertEqual(
            (body['name'], body['date'], body['currency'], body['lines_count']), ('October', '2026-10-31', 'SAR', 4),
        )
        self.assertEqual(body['journal'], {'id': self.bank.id, 'name': self.bank.name})
        self.assertEqual((body['balance_start'], body['balance_end'], body['balance_end_real']), (0, 540, 540))
        first = body['lines'][0]
        self.assertEqual(set(first), {'id', 'date', 'payment_ref', 'partner', 'amount', 'is_reconciled', 'amount_residual'})
        self.assertEqual((first['payment_ref'], first['amount'], first['is_reconciled']), ('INV/2026/00001', 750, False))
        self.assertEqual(first['partner'], {'id': self.partner.id, 'name': 'Al Noor Trading'})
        # An open line still has its whole amount to clear, in its own sign (#235).
        self.assertEqual([line['amount_residual'] for line in body['lines']], [line['amount'] for line in body['lines']])
        self.assertEqual([line['date'] for line in body['lines']], ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'])
        self.assertEqual(len(lines), 4)

    def test_statements_are_listed_and_read(self):
        body, _lines = self.statement()
        listing = self.api('GET', BANK).json()
        self.assertEqual((listing['total'], [item['id'] for item in listing['items']]), (1, [body['id']]))
        self.assertNotIn('lines', listing['items'][0])
        self.assertEqual(self.api('GET', f'{BANK}/{body["id"]}').json(), body)
        self.assertEqual(self.api('GET', BANK + f'?journal_id={self.bank.id}&date_from=2026-10-01&date_to=2026-10-31').json()['total'], 1)
        self.assertEqual(self.api('GET', BANK + '?date_from=2026-11-01').json()['total'], 0)

    def test_a_statement_of_another_company_is_404(self):
        result = self.api('GET', f'{BANK}/{self.other_statement.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        line = self.other_statement.line_ids
        for method, path, body in (
            ('GET', f'{BANK_LINES}/{line.id}/reconcile-proposals', None),
            ('POST', f'{BANK_LINES}/{line.id}/reconcile', {'account_id': self.account('500009').id}),
        ):
            with self.subTest(path=path):
                result = self.api(method, path, json=body)
                self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        self.assertEqual(self.api('GET', BANK).json()['total'], 0)

    def test_a_bad_statement_body_is_422_invalid(self):
        line = {'date': '2026-10-25', 'payment_ref': 'x', 'amount': 1}
        for overrides, field in (
            ({'unknown': 1}, 'unknown'),
            ({'lines': []}, 'lines'),
            ({'lines': 'x'}, 'lines'),
            ({'lines': [{**line, 'amount': 0}]}, 'lines[0].amount'),
            ({'lines': [{**line, 'amount': '1'}]}, 'lines[0].amount'),
            ({'lines': [{**line, 'extra': 1}]}, 'lines[0].extra'),
            ({'lines': [{**line, 'date': '25/10/2026'}]}, 'lines[0].date'),
            ({'lines': [{**line, 'partner_id': self.foreign_partner.id}]}, 'lines[0].partner_id'),
            ({'lines': [{'date': '2026-10-25', 'amount': 1}]}, 'lines[0].payment_ref'),
            ({'journal_id': self._journal(self.company, 'sale').id}, 'journal_id'),
            ({'journal_id': self.other_bank.id}, 'journal_id'),
            ({'date': 'today'}, 'date'),
            ({'balance_end_real': 'x'}, 'balance_end_real'),
        ):
            with self.subTest(overrides=overrides):
                result = self.api('POST', BANK, json=self.statement_body(**overrides))
                self.assertRefused(result, 422, 'invalid', field)
        body = self.statement_body()
        del body['journal_id']
        self.assertRefused(self.api('POST', BANK, json=body), 422, 'invalid', 'journal_id')

    # --- proposals -------------------------------------------------------------------------------------

    def test_the_proposals_of_a_line_with_a_partner_are_that_partners_open_items(self):
        # The partner's open debits: the invoice (750 left) and the outstanding receipt of the 400 payment.
        _body, lines = self.statement()
        result = self.api('GET', f'{BANK_LINES}/{lines["INV/2026/00001"]}/reconcile-proposals')
        self.assertEqual(result.status_code, 200, result.text)
        proposals = result.json()
        self.assertEqual((proposals['total'], [item['exact'] for item in proposals['items']]), (2, [True, False]))
        self.assertEqual(proposals['items'][1]['amount_residual'], 400)
        item = proposals['items'][0]
        self.assertEqual(set(item), {'id', 'date', 'entry', 'label', 'partner', 'account', 'amount_residual', 'exact'})
        self.assertEqual(item['id'], self.receivable(self.invoice).id)
        self.assertEqual((item['entry'], item['amount_residual'], item['exact']), (self.invoice.name, 750, True))
        self.assertEqual(item['partner']['id'], self.partner.id)

    def test_the_proposals_of_a_line_without_a_partner_put_the_exact_amount_first(self):
        # Another open receivable of exactly 50 (no VAT): the interest line matches it to the cent.
        small = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.riyadh.id, 'invoice_date': '2026-10-18', 'invoice_date_due': '2026-11-01',
            'invoice_line_ids': [Command.create({'name': 'Small', 'quantity': 1, 'price_unit': 50, 'tax_ids': [Command.clear()]})],
        })
        small.action_post()
        _body, lines = self.statement()
        proposals = self.api('GET', f'{BANK_LINES}/{lines["Bank interest"]}/reconcile-proposals').json()
        self.assertEqual(proposals['total'], 5)
        self.assertEqual([item['exact'] for item in proposals['items']], [True, False, False, False, False])
        self.assertEqual(proposals['items'][0]['id'], self.receivable(small).id)
        page = self.api('GET', f'{BANK_LINES}/{lines["Bank interest"]}/reconcile-proposals?limit=1&offset=1').json()
        self.assertEqual((page['total'], len(page['items'])), (5, 1))
        outflow = self.api('GET', f'{BANK_LINES}/{lines["Gulf Supplies bill"]}/reconcile-proposals').json()
        self.assertEqual([item['amount_residual'] for item in outflow['items']], [-460])

    # --- reconcile -------------------------------------------------------------------------------------

    def test_matching_a_customer_line_clears_the_invoice(self):
        _body, lines = self.statement()
        result = self.reconcile(lines['INV/2026/00001'], move_line_ids=[self.receivable(self.invoice).id])
        self.assertEqual(result.status_code, 200, result.text)
        line = result.json()
        self.assertEqual((line['id'], line['is_reconciled'], line['amount_residual']), (lines['INV/2026/00001'], True, 0))
        self.invoice.invalidate_recordset()
        self.assertEqual((self.invoice.amount_residual, self.invoice.payment_state), (0, 'paid'))
        statement = self.api('GET', f'{BANK}/{self._body_id(lines)}').json()
        self.assertEqual([item['is_reconciled'] for item in statement['lines']], [True, False, False, False])

    def _body_id(self, lines):
        return self.env['account.bank.statement.line'].browse(next(iter(lines.values()))).statement_id.id

    def test_matching_a_vendor_line_clears_the_bill(self):
        _body, lines = self.statement()
        payable = self.bill.line_ids.filtered(lambda line: line.account_id.account_type == 'liability_payable')
        result = self.reconcile(lines['Gulf Supplies bill'], move_line_ids=[payable.id])
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()['is_reconciled'])
        self.bill.invalidate_recordset()
        self.assertEqual((self.bill.amount_residual, self.bill.payment_state), (0, 'paid'))

    def test_what_the_items_leave_over_goes_to_the_named_account(self):
        _body, lines = self.statement()
        interest = self.account('500009')
        result = self.reconcile(lines['Bank interest'], account_id=interest.id, label='Q3 interest')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()['is_reconciled'])
        line = self.env['account.bank.statement.line'].browse(lines['Bank interest'])
        booked = line.move_id.line_ids.filtered(lambda item: item.account_id == interest)
        self.assertEqual((booked.credit, booked.debit, booked.name), (50, 0, 'Q3 interest'))

    def test_a_partial_match_books_the_rest_on_the_named_account(self):
        # 750 received from Al Noor, a 230 sale matched: the other 520 is booked on the named account.
        _body, lines = self.statement()
        small = self.sale(self.partner, 200, '2026-11-01')
        deferred = self.account('201018')
        refused = self.reconcile(lines['INV/2026/00001'], move_line_ids=[self.receivable(small).id])
        self.assertRefused(refused, 422, 'not_balanced', 'move_line_ids')
        result = self.reconcile(
            lines['INV/2026/00001'], move_line_ids=[self.receivable(small).id], account_id=deferred.id, label='On account',
        )
        self.assertEqual(result.status_code, 200, result.text)
        small.invalidate_recordset()
        self.assertEqual((small.payment_state, small.amount_residual), ('paid', 0))
        line = self.env['account.bank.statement.line'].browse(lines['INV/2026/00001'])
        on_account = line.move_id.line_ids.filtered(lambda item: item.account_id == deferred and item.name == 'On account')
        self.assertEqual((on_account.credit, on_account.reconciled), (520, False))

    def test_the_leftover_cannot_go_to_a_receivable_payable_or_liquidity_account(self):
        _body, lines = self.statement()
        for code in ('102011', '201002', '101001', '201031'):
            with self.subTest(account=code):
                result = self.reconcile(lines['Bank interest'], account_id=self.account(code).id)
                self.assertRefused(result, 422, 'invalid', 'account_id')

    def test_items_that_do_not_clear_a_line_without_a_partner_are_not_balanced(self):
        _body, lines = self.statement()
        result = self.reconcile(lines['Unknown deposit'], move_line_ids=[self.receivable(self.sale_late).id])
        self.assertRefused(result, 422, 'not_balanced', 'move_line_ids')
        self.assertFalse(self.env['account.bank.statement.line'].browse(lines['Unknown deposit']).is_reconciled)

    def test_a_reconciled_line_is_refused(self):
        _body, lines = self.statement()
        self.assertEqual(self.reconcile(lines['Bank interest'], account_id=self.account('500009').id).status_code, 200)
        self.assertRefused(self.reconcile(lines['Bank interest'], account_id=self.account('500009').id), 422, 'invalid_state')

    def test_a_bad_reconcile_body_is_422_invalid(self):
        _body, lines = self.statement()
        line = lines['INV/2026/00001']
        invoice_item = self.receivable(self.invoice).id
        for body, field in (
            ({}, 'move_line_ids'),
            ({'move_line_ids': []}, 'move_line_ids'),
            ({'move_line_ids': [invoice_item], 'extra': 1}, 'extra'),
            ({'move_line_ids': 'x'}, 'move_line_ids'),
            ({'move_line_ids': [invoice_item, invoice_item]}, 'move_line_ids'),
            ({'move_line_ids': [invoice_item], 'label': 'x'}, 'label'),
            ({'move_line_ids': [self.receivable(self.other_invoice).id]}, 'move_line_ids'),
            ({'move_line_ids': [self.receivable(self.sale_late).id, 0]}, 'move_line_ids'),
            ({'account_id': self.account('500009', self.other_company).id}, 'account_id'),
            ({'account_id': 'x'}, 'account_id'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.reconcile(line, **body), 422, 'invalid', field)

    def test_an_item_on_the_wrong_side_is_refused(self):
        # A payable item (money out) cannot clear a deposit.
        _body, lines = self.statement()
        payable = self.bill.line_ids.filtered(lambda item: item.account_id.account_type == 'liability_payable')
        self.assertRefused(self.reconcile(lines['INV/2026/00001'], move_line_ids=[payable.id]), 422, 'invalid', 'move_line_ids')

    # --- undoing, correcting and removing ----------------------------------------------------------------

    def test_a_reconciliation_is_undone_and_the_invoice_is_open_again(self):
        _body, lines = self.statement()
        line_id = lines['INV/2026/00001']
        self.reconcile(line_id, move_line_ids=[self.receivable(self.invoice).id])
        undone = self.api('POST', f'{BANK_LINES}/{line_id}/unreconcile')
        self.assertEqual(undone.status_code, 200, undone.text)
        self.assertEqual((undone.json()['is_reconciled'], undone.json()['amount_residual']), (False, 750))
        self.invoice.invalidate_recordset()
        self.assertEqual((self.invoice.amount_residual, self.invoice.payment_state), (750, 'partial'))
        self.assertEqual(self.reconcile(line_id, move_line_ids=[self.receivable(self.invoice).id]).status_code, 200)

    def test_unreconcile_refusals(self):
        _body, lines = self.statement()
        line_id = lines['INV/2026/00001']
        self.assertRefused(self.api('POST', f'{BANK_LINES}/{line_id}/unreconcile'), 422, 'invalid_state')
        foreign = self.other_statement.line_ids
        self.assertRefused(self.api('POST', f'{BANK_LINES}/{foreign.id}/unreconcile'), 404, 'not_found')

    def test_a_statement_header_is_corrected(self):
        body, _lines = self.statement()
        changed = self.api('PATCH', f'{BANK}/{body["id"]}', json={'name': 'October (corrected)', 'balance_end_real': 545})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual((changed.json()['name'], changed.json()['balance_end_real']), ('October (corrected)', 545))
        for bad, field in (({}, None), ({'balance_start': 'x'}, 'balance_start'), ({'lines': []}, 'lines')):
            with self.subTest(bad=bad):
                self.assertRefused(self.api('PATCH', f'{BANK}/{body["id"]}', json=bad), 422, 'invalid', field)
        self.assertRefused(self.api('PATCH', f'{BANK}/{self.other_statement.id}', json={'name': 'x'}), 404, 'not_found')

    def test_a_statement_is_deleted_only_when_nothing_is_reconciled(self):
        body, lines = self.statement()
        self.reconcile(lines['INV/2026/00001'], move_line_ids=[self.receivable(self.invoice).id])
        refused = self.api('DELETE', f'{BANK}/{body["id"]}')
        self.assertRefused(refused, 422, 'has_reconciliations')
        self.assertEqual(refused.json()['details']['line_ids'], [lines['INV/2026/00001']])
        undone = self.api('POST', f'{BANK_LINES}/{lines["INV/2026/00001"]}/unreconcile')
        self.assertEqual(undone.status_code, 200, undone.text)
        self.assertTrue(self.env['account.bank.statement'].browse(body['id']).exists(), 'statement kept by the undo')
        self.assertEqual(self.api('DELETE', f'{BANK}/{body["id"]}').status_code, 204)
        self.assertRefused(self.api('GET', f'{BANK}/{body["id"]}'), 404, 'not_found')
        self.assertRefused(self.api('DELETE', f'{BANK}/{self.other_statement.id}'), 404, 'not_found')

    # --- automatic matching ------------------------------------------------------------------------------

    def auto(self, statement_id, **body):
        result = self.api('POST', f'{BANK}/{statement_id}/auto-reconcile', json=body)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_a_dry_run_lists_the_certain_matches_and_writes_nothing(self):
        body, lines = self.statement()
        plan = self.auto(body['id'])
        self.assertEqual(plan['applied'], False)
        self.assertEqual(sorted(item['line_id'] for item in plan['matched']), sorted([lines['INV/2026/00001'], lines['Gulf Supplies bill']]))
        self.assertEqual({item['line_id']: item['reason'] for item in plan['review']}, {lines['Bank interest']: 'no_match', lines['Unknown deposit']: 'no_match'})
        self.assertEqual(self.api('GET', f'{BANK}/{body["id"]}').json()['lines'][0]['is_reconciled'], False)

    def test_applying_reconciles_only_the_certain_lines(self):
        body, _lines = self.statement()
        result = self.auto(body['id'], apply=True)
        self.assertEqual((result['applied'], len(result['matched']), len(result['review'])), (True, 2, 2))
        state = {line['payment_ref']: line['is_reconciled'] for line in self.api('GET', f'{BANK}/{body["id"]}').json()['lines']}
        self.assertEqual(state, {'INV/2026/00001': True, 'Gulf Supplies bill': True, 'Bank interest': False, 'Unknown deposit': False})
        self.invoice.invalidate_recordset()
        self.assertEqual(self.invoice.payment_state, 'paid')
        self.assertEqual(self.auto(body['id'], apply=True)['matched'], [])
        events = self.env['webvue.finance.audit.event'].search([('action', '=', 'bank_statement_auto_reconciled'), ('res_id', '=', body['id'])])
        self.assertEqual(len(events), 1)

    def test_two_candidates_are_ambiguous_and_left_for_review(self):
        for _ in range(2):
            self.sale(self.partner, 100, '2026-11-30')
        body, lines = self.statement(lines=[{'date': '2026-10-28', 'payment_ref': 'Receipt', 'partner_id': self.partner.id, 'amount': 115}], balance_end_real=115)
        plan = self.auto(body['id'], apply=True)
        self.assertEqual(plan['matched'], [])
        self.assertEqual([(item['line_id'], item['reason'], len(item['candidates'])) for item in plan['review']], [(lines['Receipt'], 'ambiguous', 2)])

    def test_the_entry_number_in_the_reference_matches_without_a_partner(self):
        body, lines = self.statement(lines=[{'date': '2026-10-28', 'payment_ref': f'Payment for {self.invoice.name}', 'amount': 750}], balance_end_real=750)
        plan = self.auto(body['id'])
        self.assertEqual([item['line_id'] for item in plan['matched']], [next(iter(lines.values()))])

    def test_auto_reconcile_refusals(self):
        body, _lines = self.statement()
        self.assertRefused(self.api('POST', f'{BANK}/{body["id"]}/auto-reconcile', json={'apply': 'yes'}), 422, 'invalid', 'apply')
        self.assertRefused(self.api('POST', f'{BANK}/{body["id"]}/auto-reconcile', json={'colour': 1}), 422, 'invalid', 'colour')
        self.assertRefused(self.api('POST', f'{BANK}/{self.other_statement.id}/auto-reconcile', json={}), 404, 'not_found')
        self.user_with('bank_reader', ['finance.bank.read'])
        self.authenticate('bank_reader', PASSWORD)
        self.assertRefused(self.api('POST', f'{BANK}/{body["id"]}/auto-reconcile', json={}), 403, 'forbidden')
