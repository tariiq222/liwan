# Part of Odoo. See LICENSE file for full copyright and licensing details.
import inspect

from odoo import Command
from odoo.tests import tagged

from .common import TAX_INCLUDED
from .write_common import INVOICES, SAUDI_VAT, LiwanFinanceWriteCase

PICK = '/api/v1/products/pick'
MODES = {'saas': 'control_plane', 'non_saas': 'local_policy'}
PRODUCT_CAPABILITIES = ('products.read', 'products.manage', 'products.prices.manage')
LOCK = '2026-10-31'
LOCKED_DAY = '2026-10-10'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceInvoiceProducts(LiwanFinanceWriteCase):
    """A customer invoice or credit note line may name a product of the products service (plan D20, PR 6)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        cls.catalog = cls.user_with('finance_catalog', PRODUCT_CAPABILITIES)
        cls.product = cls.make_product(cls.company, 'Audit service', 200.0, cls.sale_vat)

    @classmethod
    def make_product(cls, company, name, price, tax=None):
        """A product of the service owned by ``company``, made the way a migration leaves one (the superuser)."""
        return cls.env['product.template'].create({
            'name': name, 'type': 'service', 'list_price': price, 'company_id': company.id, 'liwan_product': True,
            'taxes_id': [Command.set(tax.ids if tax else [])],
        })

    def set_mode(self, mode):
        profile = self.env.ref('liwan_platform.tenant_profile')
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
            [mode, MODES[mode], profile.id],
        )
        profile.invalidate_recordset()

    def in_modes(self):
        """Run the caller's block once per commercial mode, switching the tenant between the two."""
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                yield mode

    def products_service(self, user=None, company=None):
        return self.env['liwan.products.service'].with_user(user or self.manager).with_company(company or self.company)

    def price_of(self, product, quantity=1.0):
        return self.products_service()._liwan_price(
            product, quantity=quantity, company=self.company, customer=self.partner,
        )

    def product_body(self, *lines, **overrides):
        return self.invoice_body(lines=list(lines), **overrides)

    def post_product_invoice(self, *lines, **overrides):
        result = self.api('POST', INVOICES, json=self.product_body(*lines, **overrides))
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def move_line(self, line):
        return self.env['account.move.line'].browse(line['id'])

    def registered(self, registered):
        self.company.liwan_vat_registered = registered

    def usd_rate(self, rate=0.25):
        """USD is 0.25 per SAR: a 200 SAR product costs 50 USD."""
        usd = self.env.ref('base.USD')
        usd.active = True
        self.env['res.currency.rate'].create({
            'currency_id': usd.id, 'name': '2026-10-01', 'rate': rate, 'company_id': self.company.id,
        })
        return usd

    def test_a_product_line_takes_its_label_price_and_taxes_in_both_modes(self):
        for _mode in self.in_modes():
            invoice = self.post_product_invoice({'product_id': self.product.id, 'quantity': 2})
            (line,) = invoice['lines']
            self.assertEqual(line['product'], {'id': self.product.id, 'name': 'Audit service'})
            self.assertEqual((line['name'], line['price_unit'], line['quantity']), ('Audit service', 200.0, 2))
            self.assertEqual([tax['id'] for tax in line['taxes']], self.sale_vat.ids)
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_tax'], invoice['amount_total']), (400, 60, 460))
            self.assertEqual(self.move_line(line).product_id.product_tmpl_id, self.product)

    def test_the_label_the_price_and_the_taxes_stay_editable(self):
        other_vat = self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'), ('amount_type', '=', 'percent'),
            ('amount', '!=', 15), ('id', '!=', self.sale_vat.id),
        ], limit=1)
        for _mode in self.in_modes():
            invoice = self.post_product_invoice({
                'product_id': self.product.id, 'name': 'Audit, discounted', 'price_unit': 150, 'tax_ids': other_vat.ids,
            })
            (line,) = invoice['lines']
            self.assertEqual((line['name'], line['price_unit']), ('Audit, discounted', 150))
            self.assertEqual([tax['id'] for tax in line['taxes']], other_vat.ids)
            self.assertEqual(line['product'], {'id': self.product.id, 'name': 'Audit service'})
            cleared = self.post_product_invoice({'product_id': self.product.id, 'tax_ids': []})
            self.assertEqual(cleared['lines'][0]['taxes'], [])

    def test_a_discount_applies_to_a_product_line(self):
        for _mode in self.in_modes():
            invoice = self.post_product_invoice({'product_id': self.product.id, 'quantity': 2, 'discount': 10})
            (line,) = invoice['lines']
            self.assertEqual((line['discount'], line['price_subtotal'], line['price_total']), (10, 360, 414))
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_tax'], invoice['amount_total']), (360, 54, 414))

    def test_a_product_line_is_priced_and_taxed_as_the_price_function_does_for_the_same_product_and_company(self):
        for _mode in self.in_modes():
            for quantity in (1, 3):
                with self.subTest(quantity=quantity):
                    price = self.price_of(self.product, quantity)
                    (line,) = self.post_product_invoice({'product_id': self.product.id, 'quantity': quantity})['lines']
                    self.assertEqual(line['price_unit'], price['unit_price'])
                    self.assertEqual(
                        (line['price_subtotal'], line['price_total']), (price['amount_untaxed'], price['amount_total']),
                    )
                    self.assertEqual(
                        self.move_line(line).tax_ids, self.product.taxes_id._filter_taxes_by_company(self.company),
                    )

    def test_a_price_that_includes_tax_is_recorded_as_stock_records_it(self):
        company = self._fresh_company_manager('Included Finance Co', 'included_manager', 'included_manager_pass_1', TAX_INCLUDED)
        company.write({'vat': SAUDI_VAT, 'liwan_vat_registered': True})
        product = self.make_product(company, 'Included service', 115.0, self._tax(company, 'sale'))
        partner = self.env['res.partner'].create({'name': 'Included Customer', 'liwan_party': True})
        user = self.env['res.users'].search([('login', '=', 'included_manager')])
        for _mode in self.in_modes():
            self.authenticate('included_manager', 'included_manager_pass_1')
            result = self.api('POST', INVOICES, json=self.invoice_body(partner_id=partner.id, lines=[{'product_id': product.id}]))
            self.assertEqual(result.status_code, 201, result.text)
            invoice = result.json()
            price = self.env['liwan.products.service'].with_user(user).with_company(company)._liwan_price(
                product, quantity=1.0, company=company, customer=partner,
            )
            (line,) = invoice['lines']
            self.assertEqual((line['price_unit'], line['price_subtotal'], line['price_total']), (115, 100, 115))
            self.assertEqual((line['price_subtotal'], line['price_total']), (price['amount_untaxed'], price['amount_total']))
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_tax'], invoice['amount_total']), (100, 15, 115))

    def test_the_default_price_follows_the_invoice_currency(self):
        self.usd_rate()
        for _mode in self.in_modes():
            invoice = self.post_product_invoice(
                {'product_id': self.product.id, 'quantity': 2}, currency='USD', invoice_date='2026-10-18',
            )
            (line,) = invoice['lines']
            self.assertEqual((invoice['currency'], line['price_unit']), ('USD', 50))
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_total']), (100, 115))
            typed = self.post_product_invoice(
                {'product_id': self.product.id, 'price_unit': 80}, currency='USD', invoice_date='2026-10-18',
            )
            self.assertEqual(typed['lines'][0]['price_unit'], 80)
            # A draft in SAR switched to USD in the same patch gets the converted default.
            draft = self.post_product_invoice({'product_id': self.product.id})
            patched = self.api('PATCH', f'{INVOICES}/{draft["id"]}', json={
                'currency': 'USD', 'invoice_date': '2026-10-18', 'lines': [{'product_id': self.product.id}],
            })
            self.assertEqual(patched.status_code, 200, patched.text)
            self.assertEqual(patched.json()['lines'][0]['price_unit'], 50)

    def test_a_product_default_in_a_currency_with_no_rate_is_refused(self):
        eur = self.env.ref('base.EUR')
        eur.active = True
        self.env['res.currency.rate'].search([('currency_id', '=', eur.id)]).unlink()
        for _mode in self.in_modes():
            result = self.api('POST', INVOICES, json=self.product_body({'product_id': self.product.id}, currency='EUR'))
            self.assertRefused(result, 422, 'missing_exchange_rate', 'currency')

    def test_a_product_line_of_an_establishment_not_registered_for_vat_carries_no_tax(self):
        for _mode in self.in_modes():
            self.registered(False)
            self.assertEqual(self.product.taxes_id._filter_taxes_by_company(self.company), self.sale_vat)
            invoice = self.post_product_invoice({'product_id': self.product.id, 'quantity': 2})
            (line,) = invoice['lines']
            self.assertEqual(line['taxes'], [])
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_tax'], invoice['amount_total']), (400, 0, 400))
            price = self.price_of(self.product, 2)
            self.assertEqual((price['amount_untaxed'], price['amount_tax'], price['amount_total']), (400, 0, 400))
            # A line with no product follows stock, whatever the registration says.
            plain = self.post_product_invoice({'name': 'Plain', 'price_unit': 100, 'tax_ids': self.sale_vat.ids})
            self.assertIsNone(plain['lines'][0]['product'])
            self.assertEqual(plain['amount_tax'], 15)
            self.registered(True)

    def test_a_product_line_of_an_unregistered_establishment_refuses_taxes_on_create_and_edit(self):
        draft = self.post_product_invoice({'product_id': self.product.id})
        for _mode in self.in_modes():
            self.registered(False)
            body = self.product_body({'product_id': self.product.id, 'tax_ids': self.sale_vat.ids})
            self.assertRefused(self.api('POST', INVOICES, json=body), 422, 'invalid', 'lines[0].tax_ids')
            patched = self.api('PATCH', f'{INVOICES}/{draft["id"]}', json={'lines': [
                {'name': 'Plain', 'price_unit': 1}, {'product_id': self.product.id, 'tax_ids': self.sale_vat.ids},
            ]})
            self.assertRefused(patched, 422, 'invalid', 'lines[1].tax_ids')
            self.assertEqual(self.post_product_invoice({'product_id': self.product.id, 'tax_ids': []})['amount_tax'], 0)
            self.registered(True)

    def test_editing_a_product_line_of_an_unregistered_establishment_clears_the_tax_again(self):
        for _mode in self.in_modes():
            invoice = self.post_product_invoice({'product_id': self.product.id})
            self.assertEqual(len(invoice['lines'][0]['taxes']), 1)
            self.registered(False)
            patched = self.api('PATCH', f'{INVOICES}/{invoice["id"]}', json={'lines': [{'product_id': self.product.id}]})
            self.assertEqual(patched.status_code, 200, patched.text)
            self.assertEqual((patched.json()['lines'][0]['taxes'], patched.json()['amount_tax']), ([], 0))
            self.registered(True)

    def test_the_override_extends_the_stock_taxes_compute(self):
        """An upstream rename or signature change of the stock compute fails here, not silently in production."""
        field = self.env['account.move.line']._fields['tax_ids']
        self.assertEqual(field.compute, '_compute_tax_ids')
        self.assertTrue(field.store)
        self.assertEqual(list(inspect.signature(self.env['account.move.line']._compute_tax_ids).parameters), [])
        owners = [cls for cls in type(self.env['account.move.line']).__mro__ if '_compute_tax_ids' in vars(cls)]
        self.assertGreaterEqual(len(owners), 2)
        self.assertTrue(any('liwan_finance' in owner.__module__ for owner in owners))

    def orm_invoice(self, company, lines, move_type='out_invoice'):
        return self.env['account.move'].with_company(company).create({
            'move_type': move_type, 'partner_id': self.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [Command.create(line) for line in lines],
        })

    def test_a_product_line_written_through_the_orm_in_an_unregistered_company_has_no_tax(self):
        self.registered(False)
        variant = self.product.product_variant_id
        invoice = self.orm_invoice(self.company, [{'product_id': variant.id, 'quantity': 1, 'price_unit': 100}])
        self.assertEqual((invoice.invoice_line_ids.tax_ids, invoice.amount_tax), (self.env['account.tax'], 0))
        other = self.make_product(self.company, 'Another service', 50.0, self.sale_vat).product_variant_id
        invoice.invoice_line_ids.product_id = other
        self.assertFalse(invoice.invoice_line_ids.tax_ids)
        self.registered(True)
        invoice.invoice_line_ids.product_id = variant
        self.assertEqual(invoice.invoice_line_ids.tax_ids, self.sale_vat)

    def test_a_plain_line_and_a_vendor_document_are_untouched_by_the_override(self):
        self.registered(False)
        plain = self.orm_invoice(self.company, [{
            'name': 'Plain', 'quantity': 1, 'price_unit': 100, 'tax_ids': [Command.set(self.sale_vat.ids)],
        }])
        self.assertEqual(plain.invoice_line_ids.tax_ids, self.sale_vat)
        product = self.make_product(self.company, 'Bought service', 50.0, self.sale_vat)
        product.supplier_taxes_id = [Command.set(self.purchase_vat.ids)]
        bill = self.orm_invoice(
            self.company, [{'product_id': product.product_variant_id.id, 'quantity': 1, 'price_unit': 100}], 'in_invoice',
        )
        self.assertEqual(bill.invoice_line_ids.tax_ids, self.purchase_vat)

    def test_a_tenant_with_finance_and_no_online_payments_has_the_default_tax_on_a_product_line(self):
        self.env['liwan.products.settings']._liwan_current().sharing = 'branch'
        created = self.products_service(self.catalog)._liwan_create(
            {'name': 'Default tax service', 'type': 'service', 'list_price': 100},
        ).with_env(self.env)
        default = self.env['product.template']._liwan_default_sale_tax_ids(created.company_id or self.company)
        self.assertTrue(default)
        self.assertEqual(created.taxes_id.ids, list(default))
        for _mode in self.in_modes():
            invoice = self.post_product_invoice({'product_id': created.id})
            (line,) = invoice['lines']
            self.assertEqual([tax['id'] for tax in line['taxes']], list(default))
            self.assertEqual((invoice['amount_untaxed'], invoice['amount_tax'], invoice['amount_total']), (100, 15, 115))

    def test_a_line_without_a_product_still_saves(self):
        for _mode in self.in_modes():
            invoice = self.create_invoice()
            (line,) = invoice['lines']
            self.assertEqual((line['product'], line['name'], line['price_unit']), (None, 'Consulting', 1000))
            self.assertRefused(self.api('POST', INVOICES, json=self.invoice_body(lines=[{'price_unit': 5}])), 422, 'invalid', 'lines[0].name')
            self.assertRefused(self.api('POST', INVOICES, json=self.invoice_body(lines=[{'name': 'x'}])), 422, 'invalid', 'lines[0].price_unit')
            self.assertRefused(
                self.api('POST', INVOICES, json=self.invoice_body(lines=[{'name': 'x', 'price_unit': 1, 'product_id': 'a'}])),
                422, 'invalid', 'lines[0].product_id',
            )

    def test_a_product_the_caller_cannot_read_is_refused_on_create_and_edit(self):
        foreign = self.make_product(self.other_company, 'Foreign service', 10.0)
        stock = self.env['product.template'].create({'name': 'Stock product', 'type': 'service', 'list_price': 10.0})
        archived = self.make_product(self.company, 'Archived service', 10.0)
        archived.active = False
        draft = self.create_invoice()
        for _mode in self.in_modes():
            for product in (foreign, stock, archived):
                create = self.api('POST', INVOICES, json=self.product_body({'product_id': product.id}))
                self.assertRefused(create, 422, 'invalid', 'lines[0].product_id')
                patch = self.api('PATCH', f'{INVOICES}/{draft["id"]}', json={'lines': [{'product_id': product.id}]})
                self.assertRefused(patch, 422, 'invalid', 'lines[0].product_id')
            missing = self.api('POST', INVOICES, json=self.product_body({'product_id': 999999999}))
            self.assertRefused(missing, 422, 'invalid', 'lines[0].product_id')

    def test_the_products_the_caller_may_pick_are_the_finance_managers_own_in_both_modes(self):
        reader = self.user_with('finance_reader', ['finance.invoices.read'])
        for _mode in self.in_modes():
            self.authenticate(self.manager.login, 'finance_manager_pass_123')
            picked = self.api('GET', PICK)
            self.assertEqual(picked.status_code, 200, picked.text)
            self.assertIn(self.product.id, [item['id'] for item in picked.json()['items']])
            self.authenticate(reader.login, 'finance_write_pass_123')
            self.assertEqual(self.api('GET', PICK).status_code, 403)

    def test_a_caller_who_cannot_write_invoices_cannot_name_a_product(self):
        reader = self.user_with('finance_reader_only', ['finance.invoices.read'])
        for _mode in self.in_modes():
            self.authenticate(reader.login, 'finance_write_pass_123')
            denied = self.api('POST', INVOICES, json=self.product_body({'product_id': self.product.id}))
            self.assertEqual(denied.status_code, 403, denied.text)
            self.assertEqual(denied.json()['code'], 'forbidden')

    def test_archiving_a_product_leaves_a_posted_invoice_unchanged(self):
        for _mode in self.in_modes():
            product = self.make_product(self.company, 'Archived later', 200.0, self.sale_vat)
            posted = self.post_invoice(self.post_product_invoice({'product_id': product.id, 'quantity': 2})['id'])
            self.products_service(self.catalog)._liwan_archive(product)
            self.assertFalse(product.active)
            after = self.api('GET', f'{INVOICES}/{posted["id"]}').json()
            self.assertEqual(after, posted)
            self.assertEqual(after['lines'][0]['product'], {'id': product.id, 'name': 'Archived later'})
            self.assertEqual((after['amount_untaxed'], after['amount_tax'], after['amount_total']), (400, 60, 460))

    def test_a_draft_keeps_its_archived_product_and_a_new_line_cannot_name_it(self):
        for _mode in self.in_modes():
            product = self.make_product(self.company, 'Kept archived', 200.0, self.sale_vat)
            draft = self.post_product_invoice({'product_id': product.id})
            self.products_service(self.catalog)._liwan_archive(product)
            kept = self.api('PATCH', f'{INVOICES}/{draft["id"]}', json={'ref': 'kept', 'lines': [
                {'product_id': product.id, 'quantity': 2, 'price_unit': 200},
            ]})
            self.assertEqual(kept.status_code, 200, kept.text)
            self.assertEqual(kept.json()['lines'][0]['product']['id'], product.id)
            other = self.post_product_invoice({'name': 'Plain', 'price_unit': 10})
            refused = self.api('PATCH', f'{INVOICES}/{other["id"]}', json={'lines': [{'product_id': product.id}]})
            self.assertRefused(refused, 422, 'invalid', 'lines[0].product_id')

    def test_a_vendor_bill_line_refuses_a_product(self):
        for _mode in self.in_modes():
            for move_type in ('in_invoice', 'in_refund'):
                body = self.bill_body(move_type=move_type, lines=[{
                    'name': 'Paper', 'price_unit': 100, 'tax_ids': [self.purchase_vat.id],
                }, {'product_id': self.product.id, 'price_unit': 100}])
                self.assertRefused(self.api('POST', INVOICES, json=body), 422, 'invalid', 'lines[1].product_id')
            bill = self.create_invoice(self.bill_body())
            patched = self.api('PATCH', f'{INVOICES}/{bill["id"]}', json={'lines': [{'product_id': self.product.id, 'price_unit': 1}]})
            self.assertRefused(patched, 422, 'invalid', 'lines[0].product_id')
            self.assertIsNone(bill['lines'][0]['product'])

    def test_a_credit_note_line_names_a_product_and_a_reversal_keeps_it(self):
        for _mode in self.in_modes():
            note = self.post_product_invoice({'product_id': self.product.id}, move_type='out_refund')
            self.assertEqual((note['move_type'], note['lines'][0]['product']['id']), ('out_refund', self.product.id))
            self.assertEqual((note['amount_untaxed'], note['amount_total']), (200, 230))
            posted = self.post_invoice(self.post_product_invoice({'product_id': self.product.id})['id'])
            reversed_note = self.api('POST', f'{INVOICES}/{posted["id"]}/credit-note', json={})
            self.assertEqual(reversed_note.status_code, 201, reversed_note.text)
            self.assertEqual(reversed_note.json()['lines'][0]['product']['id'], self.product.id)

    def test_the_tax_lock_pre_check_counts_the_default_taxes_of_a_product_line(self):
        self.company.tax_lock_date = LOCK
        for _mode in self.in_modes():
            locked = self.product_body({'product_id': self.product.id}, invoice_date=LOCKED_DAY)
            self.assertRefused(self.api('POST', INVOICES, json=locked), 422, 'period_locked', 'invoice_date')
            explicit = self.product_body({'product_id': self.product.id, 'tax_ids': self.sale_vat.ids}, invoice_date=LOCKED_DAY)
            self.assertRefused(self.api('POST', INVOICES, json=explicit), 422, 'period_locked', 'invoice_date')
            untaxed = self.product_body({'product_id': self.product.id, 'tax_ids': []}, invoice_date=LOCKED_DAY)
            self.assertEqual(self.api('POST', INVOICES, json=untaxed).status_code, 201)
            draft = self.create_invoice(self.invoice_body(invoice_date='2026-11-02', lines=[{'name': 'x', 'price_unit': 1}]))
            patched = self.api('PATCH', f'{INVOICES}/{draft["id"]}', json={
                'invoice_date': LOCKED_DAY, 'lines': [{'product_id': self.product.id}],
            })
            self.assertRefused(patched, 422, 'period_locked', 'invoice_date')
            self.registered(False)
            free = self.api('POST', INVOICES, json=self.product_body({'product_id': self.product.id}, invoice_date=LOCKED_DAY))
            self.assertEqual(free.status_code, 201, free.text)
            self.registered(True)
