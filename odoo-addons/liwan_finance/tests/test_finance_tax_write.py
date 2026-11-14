# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import TAX_EXCLUDED, TAX_INCLUDED, LiwanFinanceCase
from .write_common import PASSWORD, LiwanFinanceWriteCase

API = '/api/v1/finance'
TAXES = f'{API}/taxes'
TAX_KEYS = {
    'id', 'name', 'type_tax_use', 'amount_type', 'amount', 'price_include', 'price_include_editable',
    'tax_account', 'active', 'used',
}
MIGRATION = Path(__file__).parents[1] / 'migrations' / '19.0.1.8.0' / 'end-clear-sale-tax-override.py'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceTaxWrite(LiwanFinanceWriteCase):

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

    def test_an_unused_purchase_tax_can_change_its_rate(self):
        tax = self.create_tax(name='Input VAT 9%', type_tax_use='purchase', amount=9)
        changed = self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'amount': 6, 'price_include': True})
        self.assertEqual((changed.status_code, changed.json()['amount'], changed.json()['price_include']), (200, 6.0, True))

    def test_a_sale_tax_carries_no_price_include_answer(self):
        for price_include in (True, False):
            with self.subTest(price_include=price_include):
                self.assertRefused(
                    self.api('POST', TAXES, json={
                        'name': 'Sale tax with a mode', 'type_tax_use': 'sale', 'amount': 5,
                        'tax_account_id': self.vat_account().id, 'price_include': price_include,
                    }),
                    422, 'invalid', 'price_include',
                )
        tax = self.create_tax(name='Sale tax follows the company')
        record = self.env['account.tax'].browse(tax['id'])
        self.assertFalse(record.price_include_override)
        self.assertFalse(tax['price_include_editable'])
        self.assertFalse(tax['price_include'])  # the fixture company states tax_excluded

    def test_a_purchase_tax_always_carries_an_explicit_answer(self):
        excluded = self.create_tax(name='Input VAT 15% default', type_tax_use='purchase', amount=15)
        self.assertEqual((excluded['price_include'], excluded['price_include_editable']), (False, True))
        self.assertEqual(self.env['account.tax'].browse(excluded['id']).price_include_override, 'tax_excluded')
        included = self.create_tax(name='Input VAT 15% included', type_tax_use='purchase', amount=15, price_include=True)
        self.assertEqual((included['price_include'], included['price_include_editable']), (True, True))
        self.assertEqual(self.env['account.tax'].browse(included['id']).price_include_override, 'tax_included')

    def test_a_sale_tax_price_include_is_refused_on_edit(self):
        tax = self.create_tax(name='Sale tax edited')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'price_include': True}), 422, 'invalid', 'price_include')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'price_include': False}), 422, 'invalid', 'price_include')
        self.assertFalse(self.env['account.tax'].browse(tax['id']).price_include_override)

    def test_a_purchase_tax_price_include_follows_the_edit_rules(self):
        tax = self.create_tax(name='Input VAT edited', type_tax_use='purchase', amount=15)
        self.assertEqual(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'price_include': True}).json()['price_include'], True)
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'in_invoice', 'partner_id': self.vendor.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [(0, 0, {'name': 'x', 'price_unit': 100, 'quantity': 1, 'tax_ids': [(6, 0, [tax['id']])]})],
        })
        invoice.action_post()
        self.assertRefused(self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'price_include': False}), 422, 'tax_in_use', 'price_include')

    def test_changing_the_use_of_an_unused_tax_resets_the_price_include_answer(self):
        # A sale tax this route made after the copy: an override the edit must drop.
        sale = self.create_tax(name='Sale tax turned purchase')
        self.env['account.tax'].browse(sale['id']).price_include_override = 'tax_included'
        changed = self.api('PATCH', f'{TAXES}/{sale["id"]}', json={'type_tax_use': 'purchase'})
        self.assertEqual((changed.status_code, changed.json()['price_include'], changed.json()['price_include_editable']), (200, False, True))
        self.assertEqual(self.env['account.tax'].browse(sale['id']).price_include_override, 'tax_excluded')
        with_mode = self.create_tax(name='Sale tax turned purchase with a mode')
        self.env['account.tax'].browse(with_mode['id']).price_include_override = 'tax_included'
        included = self.api('PATCH', f'{TAXES}/{with_mode["id"]}', json={'type_tax_use': 'purchase', 'price_include': True})
        self.assertTrue(included.json()['price_include'])
        self.assertEqual(self.env['account.tax'].browse(with_mode['id']).price_include_override, 'tax_included')
        purchase = self.create_tax(name='Purchase tax turned sale', type_tax_use='purchase', price_include=True)
        self.assertEqual(self.env['account.tax'].browse(purchase['id']).price_include_override, 'tax_included')
        changed = self.api('PATCH', f'{TAXES}/{purchase["id"]}', json={'type_tax_use': 'sale'})
        self.assertEqual((changed.status_code, changed.json()['price_include_editable']), (200, False))
        self.assertFalse(self.env['account.tax'].browse(purchase['id']).price_include_override)

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

    def test_reactivating_an_unused_legacy_sale_tax_clears_its_override(self):
        tax = self.env['account.tax'].with_company(self.company).create({
            'name': 'Archived unused legacy tax', 'type_tax_use': 'sale', 'amount': 15,
            'active': False, 'price_include_override': TAX_EXCLUDED,
        })
        result = self.api('POST', f'{TAXES}/{tax.id}/unarchive')
        self.assertEqual((result.status_code, result.json()['active']), (200, True))
        self.env.invalidate_all()
        self.assertFalse(tax.price_include_override)

    def test_reactivating_an_archived_sale_tax_with_a_conflicting_override_is_refused(self):
        tax = self.env['account.tax'].with_company(self.company).create({
            'name': 'Archived conflicting legacy tax', 'type_tax_use': 'sale', 'amount': 15,
            'active': False, 'price_include_override': TAX_INCLUDED,
        })
        self.assertFalse(tax.is_used)
        result = self.api('POST', f'{TAXES}/{tax.id}/unarchive')
        self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(result.json()['code'], 'tax_in_use')
        self.env.invalidate_all()
        self.assertFalse(tax.active)
        self.assertEqual(tax.price_include_override, TAX_INCLUDED)

    def test_reactivating_a_used_legacy_sale_tax_with_an_override_is_refused(self):
        tax = self.env['account.tax'].with_company(self.company).create({
            'name': 'Archived used legacy tax', 'type_tax_use': 'sale', 'amount': 15,
            'price_include_override': TAX_INCLUDED,
        })
        self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'invoice_line_ids': [Command.create({
                'name': 'Legacy sale', 'price_unit': 115, 'tax_ids': [Command.set(tax.ids)],
            })],
        })
        tax.action_archive()
        result = self.api('POST', f'{TAXES}/{tax.id}/unarchive')
        self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(result.json()['code'], 'tax_in_use')
        self.env.invalidate_all()
        self.assertFalse(tax.active)
        self.assertEqual(tax.price_include_override, TAX_INCLUDED)

    def test_another_company_tax_is_not_found(self):
        foreign = self.other_sale_vat
        self.assertRefused(self.api('GET', f'{TAXES}/{foreign.id}'), 404, 'not_found')
        self.assertRefused(self.api('PATCH', f'{TAXES}/{foreign.id}', json={'name': 'x'}), 404, 'not_found')

    def test_audit_and_capability(self):
        tax = self.create_tax()
        self.api('PATCH', f'{TAXES}/{tax["id"]}', json={'name': 'Audited tax'})
        events = self.env['liwan.finance.audit.event'].search([('res_model', '=', 'account.tax'), ('res_id', '=', tax['id'])])
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


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceTaxCompanyMode(LiwanFinanceCase):
    """A sale tax follows ``res.company.account_price_include``; a purchase tax keeps its own "tax added" answer.

    Both companies are created here (the fiscal fixture's companies already hold journal items, which stock's
    lock refuses a price-mode change over), one in each mode, with a finance manager of its own.
    """

    INCLUDED = ('tax_mode_included', 'Tax mode included pass 123')
    EXCLUDED = ('tax_mode_excluded', 'Tax mode excluded pass 123')

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.included = cls._fresh_company_manager('Finance Included Company', *cls.INCLUDED, price_mode=TAX_INCLUDED)
        cls.excluded = cls._fresh_company_manager('Finance Excluded Company', *cls.EXCLUDED, price_mode=TAX_EXCLUDED)

    def call(self, session, method, path, body=None, status=200):
        """One call as the finance manager of ``session``: a ``(login, password)`` pair of a company here."""
        self.authenticate(*session)
        result = self.api(method, f'{API}{path}', json=body)
        self.assertEqual(result.status_code, status, result.text)
        return result.json()

    def tax_account(self, company):
        Account = self.env['account.account'].with_company(company)
        return Account.search([('account_type', '=', 'asset_current'), ('company_ids', 'in', company.ids)], limit=1)

    def create_tax(self, session, company, use, **overrides):
        return self.call(session, 'POST', '/taxes', {
            'name': f'{use} tax {session[0]}', 'type_tax_use': use, 'amount': 15,
            'tax_account_id': self.tax_account(company).id, **overrides,
        }, 201)

    def test_a_sale_tax_follows_the_company_mode(self):
        # A line typed at 115 with the 15% sale tax: 100 + 15 when the establishment's price includes the tax,
        # 115 + 17.25 when it does not. Three units scale both figures by three.
        for session, company, included in (
            (self.INCLUDED, self.included, True),
            (self.EXCLUDED, self.excluded, False),
        ):
            with self.subTest(company=company.name):
                tax = self.create_tax(session, company, 'sale')
                self.assertEqual((tax['price_include'], tax['price_include_editable']), (included, False))
                self.assertFalse(self.env['account.tax'].browse(tax['id']).price_include_override)
                expected = ((1, 100, 115), (3, 300, 345)) if included else ((1, 115, 132.25), (3, 345, 396.75))
                for quantity, untaxed, total in expected:
                    with self.subTest(quantity=quantity):
                        invoice = self.call(session, 'POST', '/invoices', {
                            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
                            'lines': [{
                                'name': 'Consulting', 'quantity': quantity, 'price_unit': 115, 'tax_ids': [tax['id']],
                            }],
                        }, 201)
                        self.assertEqual((invoice['amount_untaxed'], invoice['amount_total']), (untaxed, total))

    def test_renaming_a_used_sale_tax_keeps_its_stored_answer(self):
        # A sale tax that finance created before the fix carries an override and a posted document uses it.
        # A rename touches neither its use nor its price answer, so it must not change what the tax computes.
        tax = self.create_tax(self.INCLUDED, self.included, 'sale')
        self.env['account.tax'].browse(tax['id']).price_include_override = TAX_EXCLUDED
        first = self.call(self.INCLUDED, 'POST', '/invoices', {
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 115, 'tax_ids': [tax['id']]}],
        }, 201)
        self.assertEqual(first['amount_total'], 132.25)
        self.assertTrue(self.env['account.tax'].browse(tax['id']).is_used)
        renamed = self.call(self.INCLUDED, 'PATCH', f'/taxes/{tax["id"]}', {'name': 'Renamed used tax'})
        self.assertEqual((renamed['name'], renamed['price_include']), ('Renamed used tax', False))
        record = self.env['account.tax'].browse(tax['id'])
        self.assertEqual(record.price_include_override, TAX_EXCLUDED)
        second = self.call(self.INCLUDED, 'POST', '/invoices', {
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-05',
            'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 115, 'tax_ids': [tax['id']]}],
        }, 201)
        self.assertEqual(second['amount_total'], 132.25)

    def test_a_purchase_tax_is_added_under_every_company_mode(self):
        # A purchase tax keeps its own "tax added" answer: the 115 typed on a vendor bill is its amount before tax,
        # and the 15% is added on top, whichever mode the establishment chose for its sale prices.
        for session, company in ((self.INCLUDED, self.included), (self.EXCLUDED, self.excluded)):
            with self.subTest(company=company.name):
                tax = self.create_tax(session, company, 'purchase')
                self.assertEqual((tax['price_include'], tax['price_include_editable']), (False, True))
                self.assertEqual(self.env['account.tax'].browse(tax['id']).price_include_override, 'tax_excluded')
                vendor = self.call(session, 'POST', '/partners', {'name': f'Vendor {company.name}', 'vendor': True}, 201)
                bill = self.call(session, 'POST', '/invoices', {
                    'move_type': 'in_invoice', 'partner_id': vendor['id'], 'invoice_date': '2026-10-05',
                    'lines': [{'name': 'Paper', 'quantity': 1, 'price_unit': 115, 'tax_ids': [tax['id']]}],
                }, 201)
                self.assertEqual((bill['amount_untaxed'], bill['amount_total']), (115, 132.25))


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceTaxMigration(LiwanFinanceWriteCase):
    """The upgrade makes every active sale tax follow the company again."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.included = cls._saudi_company('Finance Migration Included Company', TAX_INCLUDED)

    def _migrate(self):
        spec = importlib.util.spec_from_file_location('end_clear_sale_tax_override', MIGRATION)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(self.env.cr, '19.0.1.7.0')
        self.env.invalidate_all()

    def test_the_migration_clears_only_the_active_sale_override(self):
        Tax = self.env['account.tax'].with_company(self.company)
        active_sale = Tax.create({
            'name': 'Overridden sale tax', 'type_tax_use': 'sale', 'amount': 15,
            'price_include_override': 'tax_excluded',
        })
        archived_sale = Tax.create({
            'name': 'Archived overridden sale tax', 'type_tax_use': 'sale', 'amount': 15,
            'price_include_override': 'tax_excluded', 'active': False,
        })
        purchase = Tax.create({
            'name': 'Overridden purchase tax', 'type_tax_use': 'purchase', 'amount': 15,
            'price_include_override': 'tax_included',
        })
        self._migrate()
        self._migrate()  # idempotent
        self.assertFalse(active_sale.price_include_override)
        self.assertEqual(archived_sale.price_include_override, 'tax_excluded')
        self.assertEqual(purchase.price_include_override, 'tax_included')

    def test_the_migration_reports_open_documents_before_clearing_conflicting_overrides(self):
        tax = self.env['account.tax'].with_company(self.included).create({
            'name': 'Legacy excluded VAT', 'type_tax_use': 'sale', 'amount': 15,
            'price_include_override': TAX_EXCLUDED,
        })
        invoice = self.env['account.move'].with_company(self.included).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'ref': 'Draft legacy VAT',
            'invoice_line_ids': [Command.create({
                'name': 'Legacy VAT', 'price_unit': 115, 'tax_ids': [Command.set(tax.ids)],
            })],
        })
        order = None
        if 'sale.order' in self.env:
            order = self.env['sale.order'].with_company(self.included).create({'partner_id': self.partner.id})
            product = self.env['product.product'].create({'name': 'Legacy quote product', 'type': 'service'})
            self.env['sale.order.line'].create({
                'order_id': order.id, 'product_id': product.id, 'price_unit': 115, 'tax_ids': [Command.set(tax.ids)],
            })
            self.assertEqual(order.amount_total, 132.25)
        self.assertEqual(invoice.amount_total, 132.25)
        with self.assertRaises(UserError) as refused:
            self._migrate()
        self.assertIn(f'account.move #{invoice.id}', str(refused.exception))
        self.assertEqual(tax.price_include_override, TAX_EXCLUDED)
        self.assertEqual(invoice.amount_total, 132.25)
        if order is not None:
            self.assertIn(f'sale.order #{order.id}', str(refused.exception))
            self.assertEqual(order.amount_total, 132.25)

    def test_the_migrated_sale_tax_takes_the_company_mode_on_a_customer_invoice(self):
        # The tax finance created with the old explicit "tax excluded" answer: after the migration the
        # establishment's "price includes tax" choice governs it, so a line typed at 115 totals 115 (100 + 15).
        tax = self.env['account.tax'].with_company(self.included).create({
            'name': 'Migrated sale tax', 'type_tax_use': 'sale', 'amount': 15,
            'price_include_override': TAX_EXCLUDED,
        })
        self._migrate()
        self.assertFalse(tax.price_include_override)
        self.assertTrue(tax.price_include)
        invoice = self.env['account.move'].with_company(self.included).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Consulting', 'quantity': 1, 'price_unit': 115, 'tax_ids': [Command.set(tax.ids)],
            })],
        })
        self.assertEqual((invoice.amount_untaxed, invoice.amount_tax, invoice.amount_total), (100, 15, 115))
