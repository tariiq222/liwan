# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, WebVueFinanceWriteCase

TAXES = '/api/v1/finance/taxes'
TAX_KEYS = {'id', 'name', 'type_tax_use', 'amount_type', 'amount', 'price_include', 'tax_account', 'active', 'used'}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceTaxWrite(WebVueFinanceWriteCase):

    def vat_account(self):
        Account = self.env['account.account'].with_company(self.company)
        return Account.search([('code', '=', '201990')], limit=1) or Account.create({
            'code': '201990', 'name': 'VAT test account', 'account_type': 'liability_current', 'company_ids': [(6, 0, self.company.ids)],
        })

    def create_tax(self, **overrides):
        body = {'name': 'VAT 5% special', 'type_tax_use': 'sale', 'amount': 5, 'tax_account_id': self.vat_account().id, **overrides}
        result = self.api('POST', TAXES, json=body)
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_create_and_read(self):
        tax = self.create_tax()
        self.assertEqual(set(tax), TAX_KEYS)
        self.assertEqual((tax['amount_type'], tax['amount'], tax['active'], tax['used']), ('percent', 5.0, True, False))
        record = self.env['account.tax'].browse(tax['id'])
        self.assertEqual(record.company_id, self.company)
        self.assertEqual(self.api('GET', f'{TAXES}/{tax["id"]}').json(), tax)
        self.assertIn(tax['id'], [item['id'] for item in self.api('GET', f'{TAXES}?type_tax_use=sale&q=special').json()['items']])

    def test_a_new_tax_computes_on_an_invoice(self):
        tax = self.create_tax(name='VAT 10% test', amount=10)
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 1000, 'quantity': 1, 'tax_ids': [(6, 0, [tax['id']])]})],
        })
        self.assertEqual(invoice.amount_total, 1100)

    def test_the_tax_amount_is_booked_on_the_tax_account(self):
        account = self.vat_account()
        tax = self.create_tax(name='VAT 15% own account', amount=15)
        self.assertEqual(tax['tax_account']['id'], account.id)
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 100, 'quantity': 1, 'tax_ids': [(6, 0, [tax['id']])]})],
        })
        invoice.action_post()
        self.assertEqual(invoice.line_ids.filtered(lambda line: line.account_id == account).balance, -15)
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'tax_account_id': self.bank.default_account_id.id}), 422, 'tax_in_use', 'tax_account_id')
        foreign = self.env['account.account'].search([('company_ids', 'in', self.other_company.ids)], limit=1)
        body = {'name': 'x', 'type_tax_use': 'sale', 'amount': 1, 'tax_account_id': foreign.id}
        self.assertRefused(self.api('POST', TAXES, json=body), 422, 'invalid', 'tax_account_id')

    def test_a_used_tax_keeps_its_rate(self):
        tax = self.create_tax(name='VAT 7% used', amount=7)
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 100, 'quantity': 1, 'tax_ids': [(6, 0, [tax['id']])]})],
        })
        invoice.action_post()
        self.assertTrue(self.api('GET', f'{TAXES}/{tax["id"]}').json()['used'])
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'amount': 8}), 422, 'tax_in_use', 'amount')
        renamed = self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'name': 'VAT 7% renamed', 'amount': 7})
        self.assertEqual(renamed.status_code, 200, renamed.text)

    def test_an_unused_tax_can_change_its_rate(self):
        tax = self.create_tax()
        changed = self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'amount': 6, 'price_include': True})
        self.assertEqual((changed.status_code, changed.json()['amount'], changed.json()['price_include']), (200, 6.0, True))

    def test_refusals(self):
        acc = self.vat_account().id
        for body, field in (
            ({'type_tax_use': 'sale', 'amount': 5, 'tax_account_id': acc}, 'name'),
            ({'name': 'x', 'amount': 5, 'tax_account_id': acc}, 'type_tax_use'),
            ({'name': 'x', 'type_tax_use': 'sale', 'tax_account_id': acc}, 'amount'),
            ({'name': 'x', 'type_tax_use': 'sale', 'amount': 5}, 'tax_account_id'),
            ({'name': 'x', 'type_tax_use': 'none', 'amount': 5, 'tax_account_id': acc}, 'type_tax_use'),
            ({'name': 'x', 'type_tax_use': 'sale', 'amount': -1, 'tax_account_id': acc}, 'amount'),
            ({'name': 'x', 'type_tax_use': 'sale', 'amount': 5, 'tax_account_id': acc, 'amount_type': 'group'}, 'amount_type'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', TAXES, json=body), 422, 'invalid', field)
        # A payload company_id outside the pinned request set is the uniform not-found.
        self.assertRefused(
            self.api('POST', TAXES, json={
                'name': 'x', 'type_tax_use': 'sale', 'amount': 5, 'tax_account_id': acc, 'company_id': 1,
            }),
            404, 'not_found',
        )
        self.assertRefused(self.api('GET', f'{TAXES}/999999'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{self.create_tax()["id"]}', json={}), 422, 'invalid')

    def test_archive_and_unarchive(self):
        tax = self.create_tax()
        archived = self.api('POST', f'{TAXES}/{tax["id"]}/archive')
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False))
        self.assertNotIn(tax['id'], [item['id'] for item in self.api('GET', TAXES).json()['items']])
        self.assertIn(tax['id'], [item['id'] for item in self.api('GET', f'{TAXES}?archived=true').json()['items']])
        self.assertTrue(self.api('POST', f'{TAXES}/{tax["id"]}/unarchive').json()['active'])

    def test_another_company_tax_is_not_found(self):
        foreign = self.other_sale_vat
        self.assertRefused(self.api('GET', f'{TAXES}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')

    def test_audit_and_capability(self):
        tax = self.create_tax()
        self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'name': 'Audited tax'})
        events = self.env['webvue.finance.audit.event'].search([('res_model', '=', 'account.tax'), ('res_id', '=', tax['id'])])
        self.assertEqual(set(events.mapped('action')), {'tax_created', 'tax_changed'})
        self.assertEqual(events.filtered(lambda event: event.action == 'tax_changed').fields_written, 'name')
        self.user_with('taxes_reader', ['finance.taxes.read'])
        self.authenticate('taxes_reader', PASSWORD)
        self.assertEqual(self.api('GET', TAXES).status_code, 200)
        self.assertRefused(self.api('POST', TAXES, json={'name': 'x', 'type_tax_use': 'sale', 'amount': 1, 'tax_account_id': 1}), 403, 'forbidden')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'name': 'x'}), 403, 'forbidden')
        self.user_with('taxes_writer', ['finance.taxes.manage', 'finance.taxes.read'])
        self.authenticate('taxes_writer', PASSWORD)
        self.assertEqual(self.api('POST', TAXES, json={'name': 'Allowed', 'type_tax_use': 'sale', 'amount': 1, 'tax_account_id': self.vat_account().id}).status_code, 201)
