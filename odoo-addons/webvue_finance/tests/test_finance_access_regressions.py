# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import BANK, BANK_LINES, WebVueFinanceOcaCase
from .write_common import PASSWORD

ZAKAT_ADJUSTMENTS = '/api/v1/finance/zakat/adjustments'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceAccessRegressions(WebVueFinanceOcaCase):
    """Read-only finance roles are denied on existing financial write targets."""

    def statement(self):
        result = self.api('POST', BANK, json={
            'journal_id': self.bank.id, 'date': '2026-10-31', 'name': 'October',
            'balance_start': 0, 'balance_end_real': 540,
            'lines': [
                {'date': '2026-10-25', 'payment_ref': 'INV/2026/00001', 'partner_id': self.partner.id, 'amount': 750},
                {'date': '2026-10-26', 'payment_ref': 'Gulf Supplies bill', 'partner_id': self.vendor.id, 'amount': -460},
                {'date': '2026-10-27', 'payment_ref': 'Bank interest', 'amount': 50},
                {'date': '2026-10-28', 'payment_ref': 'Unknown deposit', 'amount': 200},
            ],
        })
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        return body, {line['payment_ref']: line['id'] for line in body['lines']}

    def _audit_count(self, model, record_id, actions):
        return self.env['webvue.finance.audit.event'].sudo().search_count([
            ('res_model', '=', model), ('res_id', '=', record_id), ('action', 'in', actions),
        ])

    def _assert_denial_has_no_record_data(self, response, secrets):
        self.assertEqual(response.status_code, 403, response.text)
        body = response.text
        for secret in secrets:
            if secret:
                self.assertNotIn(str(secret), body)
        self.assertNotIn('"id"', body)
        self.assertNotIn('"lines"', body)

    def test_bank_statement_patch_and_delete_require_manage_permission(self):
        statement, _lines = self.statement()
        record = self.env['account.bank.statement'].sudo().browse(statement['id'])
        self.assertTrue(record.exists())
        self.user_with('bank_regression_reader', ['finance.bank.read'])
        self.authenticate('bank_regression_reader', PASSWORD)
        self.assertEqual(self.api('GET', f'{BANK}/{statement["id"]}').status_code, 200)

        for method, body in (('PATCH', {'name': 'Unauthorized edit'}), ('DELETE', None)):
            with self.subTest(method=method):
                before = (record.name, record.date, record.balance_start, record.balance_end_real, record.journal_id.id)
                row_count = self.env['account.bank.statement'].sudo().search_count([('id', '=', record.id)])
                audit_count = self._audit_count(record._name, record.id, ['bank_statement_changed', 'bank_statement_deleted'])
                denied = self.api(method, f'{BANK}/{statement["id"]}', json=body)
                self.assertRefused(denied, 403, 'forbidden')
                self.assertTrue(record.exists())
                self.assertEqual(self.env['account.bank.statement'].sudo().search_count([('id', '=', record.id)]), row_count)
                self.assertEqual((record.name, record.date, record.balance_start, record.balance_end_real, record.journal_id.id), before)
                self.assertEqual(self._audit_count(record._name, record.id, ['bank_statement_changed', 'bank_statement_deleted']), audit_count)
                self._assert_denial_has_no_record_data(denied, [record.name, record.journal_id.name, '750', '460', '540'])

    def test_unreconcile_requires_manage_permission_on_an_existing_reconciled_line(self):
        _statement, lines = self.statement()
        line_id = lines['INV/2026/00001']
        receivable = self.invoice.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')
        self.assertEqual(self.api(
            'POST', f'{BANK_LINES}/{line_id}/reconcile',
            json={'move_line_ids': receivable.ids},
        ).status_code, 200)

        line = self.env['account.bank.statement.line'].sudo().browse(line_id)
        self.assertTrue(line.exists())
        before = (line.payment_ref, line.amount, line.is_reconciled, line.move_id.id, line.journal_id.id)
        row_count = self.env['account.bank.statement.line'].sudo().search_count([('id', '=', line_id)])
        audit_count = self._audit_count(line._name, line.id, ['bank_line_unreconciled'])
        self.user_with('bank_regression_reader', ['finance.bank.read'])
        self.authenticate('bank_regression_reader', PASSWORD)
        denied = self.api('POST', f'{BANK_LINES}/{line_id}/unreconcile')
        self.assertRefused(denied, 403, 'forbidden')
        self.assertTrue(line.exists())
        self.assertEqual(self.env['account.bank.statement.line'].sudo().search_count([('id', '=', line_id)]), row_count)
        self.assertEqual((line.payment_ref, line.amount, line.is_reconciled, line.move_id.id, line.journal_id.id), before)
        self.assertEqual(self._audit_count(line._name, line.id, ['bank_line_unreconciled']), audit_count)
        self._assert_denial_has_no_record_data(denied, [line.payment_ref, '750', str(line.amount), self.bank.name])

    def test_zakat_adjustment_delete_requires_manage_permission_on_existing_adjustment(self):
        created = self.api('POST', ZAKAT_ADJUSTMENTS, json={
            'date_to': '2026-12-31', 'kind': 'deduct', 'label': 'Regression fixture', 'amount': 100,
        })
        self.assertEqual(created.status_code, 201, created.text)
        adjustment_id = created.json()['id']
        adjustment = self.env['webvue.finance.zakat.adjustment'].sudo().browse(adjustment_id)
        self.assertTrue(adjustment.exists())
        before = (adjustment.date_to, adjustment.kind, adjustment.label, adjustment.amount, adjustment.note, adjustment.company_id.id)
        row_count = self.env['webvue.finance.zakat.adjustment'].sudo().search_count([('id', '=', adjustment_id)])
        audit_count = self._audit_count(adjustment._name, adjustment.id, ['zakat_adjustment_removed'])
        self.user_with('zakat_regression_reader', ['finance.zakat.read'])
        self.authenticate('zakat_regression_reader', PASSWORD)

        denied = self.api('DELETE', f'{ZAKAT_ADJUSTMENTS}/{adjustment_id}')
        self.assertRefused(denied, 403, 'forbidden')
        self.assertTrue(adjustment.exists())
        self.assertEqual(self.env['webvue.finance.zakat.adjustment'].sudo().search_count([('id', '=', adjustment_id)]), row_count)
        self.assertEqual((adjustment.date_to, adjustment.kind, adjustment.label, adjustment.amount, adjustment.note, adjustment.company_id.id), before)
        self.assertEqual(self._audit_count(adjustment._name, adjustment.id, ['zakat_adjustment_removed']), audit_count)
        self._assert_denial_has_no_record_data(denied, [adjustment.label, str(adjustment.amount), '100'])
